import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import path from "path";
import os from "os";
import { stringify } from "yaml";

// `nextStage` is swapped out only for the one test that has to reach the null-next guard. No
// stage in STAGE_ORDER can reach it today, and the only stage outside it that owns a questions
// file is `need_operator`, which is delegated away one line earlier.
const stages = vi.hoisted(() => ({ forceNoNextStage: false }));
vi.mock("../../src/pipeline/states.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/pipeline/states.js")>();
  return {
    ...actual,
    nextStage: (stage: Parameters<typeof actual.nextStage>[0]) =>
      stages.forceNoNextStage ? null : actual.nextStage(stage),
  };
});

vi.mock("../../src/utils/logger.js", () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dim: vi.fn(),
    guard: vi.fn(),
  },
}));

import { tryAdvance } from "../../src/state/advancement.js";
import { readState } from "../../src/state/store.js";
import { OPERATOR_RESUME_MARKER } from "../../src/pipeline/operator-block.js";
import { parseExecutionStatus, rowStatus } from "../../src/pipeline/execute-table.js";
import { log } from "../../src/utils/logger.js";

let tmpDir: string;
let planDir: string;
const PLAN_REL = "plans/0001_test";

beforeEach(() => {
  vi.clearAllMocks();
  stages.forceNoNextStage = false;
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "jugg-adv-"));
  planDir = path.join(tmpDir, PLAN_REL);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(
    path.join(planDir, "state.yml"),
    stringify({ stage: "need_product", title: "Test" }),
    "utf-8",
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("tryAdvance", () => {
  it("returns no_questions_file when file does not exist", async () => {
    const result = await tryAdvance(PLAN_REL, "need_product", tmpDir);
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("no_questions_file");
  });

  it("returns no_marker when file exists but has no marker", async () => {
    writeFileSync(
      path.join(planDir, "01_product_questions.md"),
      "### Q1: Test\n\n**Answer:**\nYes.\n",
      "utf-8",
    );
    const result = await tryAdvance(PLAN_REL, "need_product", tmpDir);
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("no_marker");
  });

  it("returns incomplete_answers and unchecks marker when answers are blank", async () => {
    writeFileSync(
      path.join(planDir, "01_product_questions.md"),
      "### Q1: Test\n\n**Answer:**\n<!-- write your answer here -->\n\n# Complete\n\n- [x] Ready to advance to Product Review\n",
      "utf-8",
    );
    const result = await tryAdvance(PLAN_REL, "need_product", tmpDir);
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("incomplete_answers");
    // Marker should be unchecked
    const content = readFileSync(
      path.join(planDir, "01_product_questions.md"),
      "utf-8",
    );
    expect(content).toContain("- [ ] Ready to advance to Product Review");
    expect(content).not.toContain("[x]");
  });

  it("advances state when marker present and answers complete", async () => {
    writeFileSync(
      path.join(planDir, "01_product_questions.md"),
      "### Q1: Test\n\n**Answer:**\nYes, this is complete.\n\n# Complete\n\n- [x] Ready to advance to Product Review\n",
      "utf-8",
    );
    const result = await tryAdvance(PLAN_REL, "need_product", tmpDir);
    expect(result.advanced).toBe(true);
    expect(result.reason).toBe("advanced");
    const state = readState(planDir);
    expect(state.stage).toBe("ai_product_review");
  });

  it("returns no_questions_file for stages without mapping", async () => {
    const result = await tryAdvance(PLAN_REL, "ai_product_review", tmpDir);
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("no_questions_file");
  });

  it("returns incomplete_checklist at need_decision with unticked items", async () => {
    writeFileSync(
      path.join(planDir, "state.yml"),
      stringify({ stage: "need_decision", title: "Test" }),
      "utf-8",
    );
    writeFileSync(
      path.join(planDir, "06_decision.md"),
      "# Decision\n\n- [ ] Verify deploy\n- [x] Check logs\n\n# Complete\n\n- [x] Ready to advance to Done\n",
      "utf-8",
    );
    const result = await tryAdvance(PLAN_REL, "need_decision", tmpDir);
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("incomplete_checklist");
    // Completion marker should be unchecked
    const content = readFileSync(path.join(planDir, "06_decision.md"), "utf-8");
    expect(content).toContain("- [ ] Ready to advance to Done");
  });

  it("advances at need_decision when all items are ticked", async () => {
    writeFileSync(
      path.join(planDir, "state.yml"),
      stringify({ stage: "need_decision", title: "Test" }),
      "utf-8",
    );
    writeFileSync(
      path.join(planDir, "06_decision.md"),
      "# Decision\n\n- [x] Verify deploy\n- [x] Check logs\n\n# Complete\n\n- [x] Ready to advance to Done\n",
      "utf-8",
    );
    const result = await tryAdvance(PLAN_REL, "need_decision", tmpDir);
    expect(result.advanced).toBe(true);
    expect(result.reason).toBe("advanced");
    const state = readState(planDir);
    expect(state.stage).toBe("done");
  });
});

// --- Operator pause -----------------------------------------------------------------------------

const BRANCH = "vibe-racer/0001_test";

function table(rows: string[]): string {
  return [
    "## Execution Status",
    "",
    "| Milestone | Name | Owner | Status | Commit | Notes |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

const SIGNED_OFF = "\n# Complete\n\n- [x] Ready to advance to Execution\n";

function pauseBlock(
  rowId: string,
  opts: { markerTicked?: boolean; items?: Array<[string, boolean]>; number?: number } = {},
): string {
  const items = opts.items ?? [["Merge PR #12", true]];
  return [
    "",
    `## Operator actions — pause ${opts.number ?? 1} (${rowId})`,
    "",
    "**Why paused:** the gate has to be cleared by hand.",
    "",
    ...items.map(([text, ticked]) => `- [${ticked ? "x" : " "}] ${text}`),
    "",
    `- [${opts.markerTicked ? "x" : " "}] ${OPERATOR_RESUME_MARKER}`,
    "",
    `When done, switch back to branch \`${BRANCH}\`, tick every box above and run \`vibe-racer drive\`.`,
    "",
  ].join("\n");
}

function writePlaybook(body: string): void {
  writeFileSync(path.join(planDir, "04_execute.md"), body, "utf-8");
}

function playbook(): string {
  return readFileSync(path.join(planDir, "04_execute.md"), "utf-8");
}

function pauseState(rowId: string, pausedStage = "ready_to_execute"): void {
  writeFileSync(
    path.join(planDir, "state.yml"),
    stringify({
      stage: "need_operator",
      title: "Test",
      paused_stage: pausedStage,
      operator_reason: "the gate has to be cleared by hand",
      operator_milestone: rowId,
    }),
    "utf-8",
  );
}

describe("tryAdvance at need_operator", () => {
  it("does not resume on a ticked 'Ready to advance to Execution' alone (AC8)", async () => {
    pauseState("G1");
    writePlaybook(
      table(["| G1 | Merge the PRs | `operator` | `pending` | — | — |", "| M2 | Wire it up | `agent` | `pending` | — | — |"]) +
        pauseBlock("G1", { markerTicked: false }) +
        SIGNED_OFF,
    );

    const result = await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("no_marker");
    expect(readState(planDir).stage).toBe("need_operator");
  });

  it("does not resume on a ticked marker in an EARLIER block (AC8)", async () => {
    pauseState("G2");
    writePlaybook(
      table(["| G1 | Merge the PRs | `operator` | `done` | — | — |", "| G2 | Tag the build | `operator` | `pending` | — | — |", "| M3 | Ship | `agent` | `pending` | — | — |"]) +
        pauseBlock("G1", { markerTicked: true, number: 1 }) +
        pauseBlock("G2", { markerTicked: false, number: 2 }),
    );

    const result = await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("no_marker");
    expect(readState(planDir).stage).toBe("need_operator");
  });

  it("unticks the marker and lists outstanding items, starting no session (AC7)", async () => {
    pauseState("G1");
    writePlaybook(
      table(["| G1 | Merge the PRs | `operator` | `pending` | — | — |", "| M2 | Wire it up | `agent` | `pending` | — | — |"]) +
        pauseBlock("G1", {
          markerTicked: true,
          items: [["Merge PR #12", true], ["Merge PR #14", false]],
        }),
    );

    const result = await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("incomplete_checklist");
    expect(readState(planDir).stage).toBe("need_operator");
    expect(playbook()).toContain(`- [ ] ${OPERATOR_RESUME_MARKER}`);
    // The item checkboxes are left exactly as the operator left them.
    expect(playbook()).toContain("- [x] Merge PR #12");
    expect(playbook()).toContain("- [ ] Merge PR #14");
  });

  it("settles an operator gate row to done and resumes (AC9)", async () => {
    pauseState("G1");
    writePlaybook(
      table(["| G1 | Merge the PRs | `operator` | `pending` | — | — |", "| M2 | Wire it up | `agent` | `pending` | — | — |"]) +
        pauseBlock("G1", { markerTicked: true }),
    );

    const result = await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    expect(result.advanced).toBe(true);
    expect(result.reason).toBe("resumed");
    expect(rowStatus(parseExecutionStatus(playbook()), "G1")).toBe("done");
  });

  it("settles an agent row back to pending for a retry (AC9)", async () => {
    pauseState("M2");
    writePlaybook(
      table(["| M1 | Parser | `agent` | `done` | — | — |", "| M2 | Wire it up | `agent` | `needs_operator` | — | — |"]) +
        pauseBlock("M2", { markerTicked: true }),
    );

    const result = await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    expect(result.advanced).toBe(true);
    expect(rowStatus(parseExecutionStatus(playbook()), "M2")).toBe("pending");
  });

  it("leaves a row the operator hand-edited to done alone (AC9)", async () => {
    pauseState("M2");
    writePlaybook(
      table(["| M1 | Parser | `agent` | `done` | — | — |", "| M2 | Wire it up | `agent` | `done` | — | — |"]) +
        pauseBlock("M2", { markerTicked: true }),
    );

    const result = await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    expect(result.advanced).toBe(true);
    expect(rowStatus(parseExecutionStatus(playbook()), "M2")).toBe("done");
  });

  it("resumes cleanly when the operator renamed or deleted the row (AC9)", async () => {
    pauseState("G1");
    writePlaybook(
      table(["| M1 | Parser | `agent` | `done` | — | — |", "| M2 | Wire it up | `agent` | `pending` | — | — |"]) +
        pauseBlock("G1", { markerTicked: true }),
    );

    const result = await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    expect(result.advanced).toBe(true);
    expect(result.reason).toBe("resumed");
    // Untouched: no phantom row appears and no existing one changes.
    const rows = parseExecutionStatus(playbook()).rows;
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(["M1:done", "M2:pending"]);
  });

  it("writes resumed_at and clears the pause fields", async () => {
    pauseState("G1");
    writePlaybook(
      table(["| G1 | Merge the PRs | `operator` | `pending` | — | — |", "| M2 | Wire it up | `agent` | `pending` | — | — |"]) +
        pauseBlock("G1", { markerTicked: true }),
    );

    await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    const state = readState(planDir);
    expect(state.stage).toBe("ready_to_execute");
    expect(state.resumed_at).toBe("G1");
    expect(state.operator_reason).toBeUndefined();
    expect(state.operator_milestone).toBeUndefined();
    expect(state.paused_stage).toBeUndefined();
  });

  // An escaping throw here would abort driveCommand for EVERY task, before any is selected.
  it("returns unparsable_table instead of throwing, and stays paused", async () => {
    pauseState("G1");
    writePlaybook(
      [
        "## Execution Status",
        "",
        "| Milestone | Name | Owner | Status |",
        "|---|---|---|---|",
        "| G1 | Merge the PRs | `operator` | `almost` |",
        "",
      ].join("\n") + pauseBlock("G1", { markerTicked: true }),
    );

    const result = await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("unparsable_table");
    expect(readState(planDir).stage).toBe("need_operator");
  });

  it("returns no_marker when the playbook has no pause block at all", async () => {
    pauseState("G1");
    writePlaybook(table(["| M1 | Parser | `agent` | `pending` | — | — |"]));

    const result = await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("no_marker");
  });
});

describe("tryAdvance generic path", () => {
  // The version this replaces guarded the updateStage WRITE with `if (next)` but not the
  // return — a permanent false success for any stage that owns a questions file and sits
  // outside STAGE_ORDER: drive logs "advanced", changes nothing, and does it again forever.
  it("returns no_next_stage instead of a false success when nextStage is null", async () => {
    stages.forceNoNextStage = true;
    writeFileSync(
      path.join(planDir, "state.yml"),
      stringify({ stage: "need_decision", title: "Test" }),
      "utf-8",
    );
    writeFileSync(
      path.join(planDir, "06_decision.md"),
      "# Decision\n\n- [x] Verify deploy\n\n# Complete\n\n- [x] Ready to advance to Done\n",
      "utf-8",
    );

    const result = await tryAdvance(PLAN_REL, "need_decision", tmpDir);

    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("no_next_stage");
    expect(readState(planDir).stage).toBe("need_decision");
  });

  // H1 regression test: this is the exact shape that loops forever if the need_operator
  // delegation is dropped — a ticked Execution sign-off sitting in the same file the paused
  // stage points at. It must report no advance whichever branch handles it.
  it("never reports advanced:true without changing the stage", async () => {
    writeFileSync(
      path.join(planDir, "state.yml"),
      stringify({ stage: "need_operator", title: "Test", paused_stage: "ready_to_execute" }),
      "utf-8",
    );
    // A ticked Execution sign-off and no pause block: the shape that, without the delegation
    // and the null-next guard, returns advanced:true on every drive while nothing moves.
    writePlaybook(table(["| M1 | Parser | `agent` | `pending` | — | — |"]) + SIGNED_OFF);

    const result = await tryAdvance(PLAN_REL, "need_operator", tmpDir);

    expect(result.advanced).toBe(false);
    expect(readState(planDir).stage).toBe("need_operator");
  });
});

describe("tryAdvance at need_execution", () => {
  function signOffState(): void {
    writeFileSync(
      path.join(planDir, "state.yml"),
      stringify({ stage: "need_execution", title: "Test" }),
      "utf-8",
    );
  }

  it("announces the operator gates and advances (AC14)", async () => {
    signOffState();
    writePlaybook(
      table([
        "| M1 | Parser | `agent` | `pending` | — | — |",
        "| G1 | Merge the PRs | `operator` | `pending` | — | — |",
        "| M2 | Wire it up | `agent` | `pending` | — | — |",
        "| G2 | Provision staging | `operator` | `pending` | — | — |",
        "| M3 | Ship | `agent` | `pending` | — | — |",
      ]) + SIGNED_OFF,
    );

    const result = await tryAdvance(PLAN_REL, "need_execution", tmpDir);

    expect(result.advanced).toBe(true);
    expect(readState(planDir).stage).toBe("ready_to_execute");
    expect(log.info).toHaveBeenCalledWith("This plan contains 2 operator gates: G1, G2");
  });

  it("says so when there are no gates", async () => {
    signOffState();
    writePlaybook(table(["| M1 | Parser | `agent` | `pending` | — | — |"]) + SIGNED_OFF);

    const result = await tryAdvance(PLAN_REL, "need_execution", tmpDir);

    expect(result.advanced).toBe(true);
    expect(log.info).toHaveBeenCalledWith(
      "This plan contains no operator gates — execution runs start to finish.",
    );
  });

  // Failing the tick would strand the task at a stage whose checkbox already says go.
  it("warns but still advances when the table cannot be parsed", async () => {
    signOffState();
    writePlaybook("# Execution Playbook\n\nNo table here at all.\n" + SIGNED_OFF);

    const result = await tryAdvance(PLAN_REL, "need_execution", tmpDir);

    expect(result.advanced).toBe(true);
    expect(readState(planDir).stage).toBe("ready_to_execute");
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not read the Execution Status table"),
    );
  });

  it("refuses to advance on a trailing operator row (D11)", async () => {
    signOffState();
    writePlaybook(
      table([
        "| M1 | Parser | `agent` | `pending` | — | — |",
        "| G9 | Merge PR #2 | `operator` | `pending` | — | — |",
        "| G10 | Tag v0.1-backend | `operator` | `pending` | — | — |",
      ]) + SIGNED_OFF,
    );

    const result = await tryAdvance(PLAN_REL, "need_execution", tmpDir);

    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("trailing_operator_rows");
    expect(readState(planDir).stage).toBe("need_execution");
    expect(playbook()).toContain("- [ ] Ready to advance to Execution");

    const warning = vi.mocked(log.warn).mock.calls.map((c) => String(c[0])).join("\n");
    expect(warning).toContain("G9 — Merge PR #2");
    expect(warning).toContain("G10 — Tag v0.1-backend");
    expect(warning).toContain("do not belong in the Execution Status table");
  });

  it("advances when the same gate is followed by a milestone it unblocks (D11)", async () => {
    signOffState();
    writePlaybook(
      table([
        "| M1 | Parser | `agent` | `pending` | — | — |",
        "| G9 | Merge PR #2 | `operator` | `pending` | — | — |",
        "| M2 | Build on the merged PR | `agent` | `pending` | — | — |",
      ]) + SIGNED_OFF,
    );

    const result = await tryAdvance(PLAN_REL, "need_execution", tmpDir);

    expect(result.advanced).toBe(true);
    expect(readState(planDir).stage).toBe("ready_to_execute");
    expect(log.info).toHaveBeenCalledWith("This plan contains 1 operator gate: G9");
  });
});
