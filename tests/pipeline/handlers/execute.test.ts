import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import { findLastPauseBlock } from "../../../src/pipeline/operator-block.js";
import type { TaskContext } from "../../../src/pipeline/types.js";

// --- Fakes ------------------------------------------------------------------------------------
// The playbook and `state.yml` are held in memory rather than asserted through mock calls: the
// loop reads back what it wrote, so a fake that forgets is a fake that cannot catch AC1.

const files = new Map<string, string>();
let state: Record<string, unknown> = {};

const mockRunAndStream = vi.fn().mockResolvedValue("");
const mockCommitAll = vi.fn().mockResolvedValue("exec123");
const mockRepoSnapshot = vi.fn().mockResolvedValue({ head: "head0", dirtyFiles: [] });

const mockReadState = vi.fn(() => ({ ...state }));
const mockUpdateStage = vi.fn((_planPath: string, stage: string) => {
  state.stage = stage;
});
function recordPause(_planPath: string, args: { milestone: string; reason: string }): void {
  state = {
    ...state,
    stage: "need_operator",
    paused_stage: "ready_to_execute",
    operator_milestone: args.milestone,
    operator_reason: args.reason,
    resumed_at: undefined,
  };
}
const mockPauseForOperator = vi.fn(recordPause);
const mockClearResumedAt = vi.fn(() => {
  state.resumed_at = undefined;
});

vi.mock("fs/promises", () => ({
  readFile: (file: string) => {
    const content = files.get(file);
    return content === undefined
      ? Promise.reject(new Error(`ENOENT: no such file '${file}'`))
      : Promise.resolve(content);
  },
  writeFile: (file: string, content: string) => {
    files.set(file, content);
    return Promise.resolve();
  },
}));

vi.mock("../../../src/claude/session.js", () => ({
  runAndStream: (...args: unknown[]) => mockRunAndStream(...args),
}));

vi.mock("../../../src/claude/prompts.js", () => ({
  executeMilestonePrompt: () => ({ prompt: "exec prompt", persona: "exec persona" }),
}));

vi.mock("../../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({}),
  commitAll: (...args: unknown[]) => mockCommitAll(...args),
  repoSnapshot: (...args: unknown[]) => mockRepoSnapshot(...args),
}));

vi.mock("../../../src/state/store.js", () => ({
  readState: (...args: unknown[]) => mockReadState(...(args as [])),
  updateStage: (...args: unknown[]) => mockUpdateStage(...(args as [string, string])),
  pauseForOperator: (...args: unknown[]) =>
    mockPauseForOperator(...(args as [string, { milestone: string; reason: string }])),
  clearResumedAt: (...args: unknown[]) => mockClearResumedAt(...(args as [])),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dim: vi.fn(),
    guard: vi.fn(),
  },
}));

const CTX: TaskContext = {
  taskNumber: 5,
  title: "infinite-loop-fix",
  slug: "infinite-loop-fix",
  plansDir: "plans",
  planPath: "plans/0005_infinite-loop-fix",
  branchName: "vibe-racer/0005_infinite-loop-fix",
  cwd: "/tmp/repo",
  contextFiles: ["README.md"],
};

const PLAYBOOK_PATH = path.join(CTX.cwd, CTX.planPath, "04_execute.md");
const PLAN_PATH = path.join(CTX.cwd, CTX.planPath, "03_plan.md");

/** A minimal but real playbook — parsed by the real parser, never by a stub. */
function playbook(rows: string[], opts: { owner?: boolean } = {}): string {
  const header = opts.owner
    ? "| Milestone | Name | Owner | Status | Commit | Notes |\n|---|---|---|---|---|---|"
    : "| Milestone | Name | Status | Commit | Notes |\n|---|---|---|---|---|";
  return [
    "# Execution Playbook",
    "",
    "## Execution Status",
    "",
    header,
    ...rows,
    "",
    "## Milestone Summary",
    "",
    "Nothing here is ever read by the loop.",
    "",
  ].join("\n");
}

function lastBlock(content: string): string {
  const location = findLastPauseBlock(content);
  if (!location) throw new Error("no pause block in the playbook");
  return content
    .split("\n")
    .slice(location.startLine, location.endLine + 1)
    .join("\n");
}

async function loadHandler() {
  return import("../../../src/pipeline/handlers/execute.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  files.clear();
  state = { stage: "ready_to_execute", title: "infinite-loop-fix" };
  // `clearAllMocks` forgets calls, not implementations — a test that overrides one must not
  // leak it into the next.
  mockRunAndStream.mockResolvedValue("");
  mockCommitAll.mockResolvedValue("exec123");
  mockRepoSnapshot.mockResolvedValue({ head: "head0", dirtyFiles: [] });
  mockPauseForOperator.mockImplementation(recordPause);
});

// --- AC1 — the test that would hang on the old loop --------------------------------------------

describe("handleExecute — AC1", () => {
  it(
    "runs exactly two sessions on an unchanged table, then pauses for the operator",
    { timeout: 5_000 },
    async () => {
      files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `pending` | | |"]));
      mockRunAndStream.mockResolvedValue(
        "I cannot finish M1: the schema file this milestone edits does not exist.",
      );

      const { handleExecute } = await loadHandler();
      await handleExecute(CTX);

      expect(mockRunAndStream.mock.calls.length).toBe(2);
      expect(mockReadState().stage).toBe("need_operator");

      const block = lastBlock(files.get(PLAYBOOK_PATH)!);
      expect(block).toContain(
        "I cannot finish M1: the schema file this milestone edits does not exist.",
      );
    },
  );
});


// --- The pure core — zero mocks ---------------------------------------------------------------
// These build a real table with the real parser and drive `decideNextStep`/`foldOutcome` by
// hand. Nothing below touches the fakes above.

describe("decideNextStep / foldOutcome", () => {
  interface Core {
    decideNextStep: typeof import("../../../src/pipeline/handlers/execute.js")["decideNextStep"];
    foldOutcome: typeof import("../../../src/pipeline/handlers/execute.js")["foldOutcome"];
    thresholdFor: typeof import("../../../src/pipeline/handlers/execute.js")["thresholdFor"];
    sessionCap: typeof import("../../../src/pipeline/handlers/execute.js")["sessionCap"];
    MAX_STALLED_SESSIONS: number;
    SESSION_CAP_SLACK: number;
  }

  let core: Core;
  let parse: typeof import("../../../src/pipeline/execute-table.js")["parseExecutionStatus"];

  beforeEach(async () => {
    core = (await loadHandler()) as unknown as Core;
    parse = (await import("../../../src/pipeline/execute-table.js")).parseExecutionStatus;
  });

  type LoopState = ReturnType<Core["foldOutcome"]>;
  type Overrides = Partial<Omit<LoopState, "table">>;

  function loop(content: string, over: Overrides = {}): LoopState {
    const table = parse(content, "04_execute.md");
    return {
      table,
      currentId: null,
      stalls: 0,
      sessionsThisDrive: 0,
      sessionCap: core.sessionCap(table),
      resumedAt: null,
      lastOutcome: null,
      ...over,
    } as LoopState;
  }

  function label(step: ReturnType<Core["decideNextStep"]>): string {
    if (step.kind === "complete") return "complete";
    if (step.kind === "run") return `run:${step.row.id}`;
    return `pause:${step.cause}:${step.row.id}`;
  }

  /** Walk the loop with a table that never changes — the AC1 shape, purely. */
  function walk(content: string, over: Overrides = {}, ticks = 6): string[] {
    let state = loop(content, over);
    const seen: string[] = [];
    for (let i = 0; i < ticks; i++) {
      const step = core.decideNextStep(state);
      seen.push(label(step));
      if (step.kind !== "run") break;
      state = core.foldOutcome(state, {
        rowId: step.row.id,
        statusAfter: step.row.status,
        doneCountBefore: 0,
        doneCountAfter: 0,
        repoChanged: false,
        finalMessage: null,
      });
    }
    return seen;
  }

  it("AC1 — an unchanged table runs twice, then pauses on a stall", () => {
    expect(walk(playbook(["| M1 | Parser | `pending` | | |"]))).toEqual([
      "run:M1",
      "run:M1",
      "pause:stall:M1",
    ]);
  });

  it("AC2 — a needs_operator row pauses as agent_declared, with no session", () => {
    expect(walk(playbook(["| M1 | Parser | `needs_operator` | | |"]))).toEqual([
      "pause:agent_declared:M1",
    ]);
  });

  it("AC2 — one session that declares needs_operator pauses on the next tick", () => {
    const before = playbook(["| M1 | Parser | `pending` | | |"]);
    const after = playbook(["| M1 | Parser | `needs_operator` | | |"]);

    let state = loop(before);
    expect(label(core.decideNextStep(state))).toBe("run:M1");

    state = core.foldOutcome({ ...state, table: parse(after, "04_execute.md") }, {
      rowId: "M1",
      statusAfter: "needs_operator",
      doneCountBefore: 0,
      doneCountAfter: 0,
      repoChanged: true,
      finalMessage: "I need the operator",
    });

    expect(state.stalls).toBe(0);
    expect(state.sessionsThisDrive).toBe(1);
    expect(label(core.decideNextStep(state))).toBe("pause:agent_declared:M1");
  });

  it("AC3 — an operator-owned row pauses as a planned gate before any run", () => {
    const content = playbook(
      [
        "| G1 | Operator merges PR #12 | `operator` | `pending` | | |",
        "| M1 | Wire the parser | `agent` | `pending` | | |",
      ],
      { owner: true },
    );
    expect(walk(content)).toEqual(["pause:planned_gate:G1"]);
  });

  it("AC11 — a legacy `blocked` row pauses as legacy_blocked", () => {
    expect(walk(playbook(["| M1 | Parser | `blocked` | | |"]))).toEqual([
      "pause:legacy_blocked:M1",
    ]);
  });

  it("D11 — trailing operator rows complete the lap, they never gate it", () => {
    const content = playbook(
      [
        "| M1 | Parser | `agent` | `done` | abc123 | |",
        "| G9 | Merge PR #2 | `operator` | `pending` | | |",
        "| G10 | Tag v0.1-backend | `operator` | `pending` | | |",
      ],
      { owner: true },
    );
    expect(walk(content)).toEqual(["complete"]);
  });

  it("D11 — an agent row after the gate makes it a real gate again", () => {
    const content = playbook(
      [
        "| M1 | Parser | `agent` | `done` | abc123 | |",
        "| G9 | Merge PR #2 | `operator` | `pending` | | |",
        "| M2 | Build on the merge | `agent` | `pending` | | |",
        "| G10 | Tag v0.1-backend | `operator` | `pending` | | |",
      ],
      { owner: true },
    );
    expect(walk(content)).toEqual(["pause:planned_gate:G9"]);
  });

  it("AC4 — a finished milestone resets the stall count; the pause lands on the next row", () => {
    const first = playbook([
      "| M1 | Parser | `pending` | | |",
      "| M2 | Loop | `pending` | | |",
    ]);
    const second = playbook([
      "| M1 | Parser | `done` | abc123 | |",
      "| M2 | Loop | `pending` | | |",
    ]);

    let state = loop(first);
    expect(label(core.decideNextStep(state))).toBe("run:M1");

    state = core.foldOutcome({ ...state, table: parse(second, "04_execute.md") }, {
      rowId: "M1",
      statusAfter: "done",
      doneCountBefore: 0,
      doneCountAfter: 1,
      repoChanged: true,
      finalMessage: null,
    });
    expect(state.stalls).toBe(0);

    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const step = core.decideNextStep(state);
      seen.push(label(step));
      if (step.kind !== "run") break;
      state = core.foldOutcome(state, {
        rowId: "M2",
        statusAfter: "pending",
        doneCountBefore: 1,
        doneCountAfter: 1,
        repoChanged: false,
        finalMessage: null,
      });
    }
    expect(seen).toEqual(["run:M2", "run:M2", "pause:stall:M2"]);
  });

  it("AC5 — the session cap pauses, it never throws", () => {
    const content = playbook(["| M1 | Parser | `pending` | | |"]);
    const state = loop(content, { sessionsThisDrive: 4, sessionCap: 4 });
    expect(label(core.decideNextStep(state))).toBe("pause:session_cap:M1");
  });

  it("AC5 — the cap outranks a run but never an already-declared pause", () => {
    const content = playbook(["| M1 | Parser | `needs_operator` | | |"]);
    const state = loop(content, { sessionsThisDrive: 99, sessionCap: 4 });
    expect(label(core.decideNextStep(state))).toBe("pause:agent_declared:M1");
  });

  it("AC6 — after an overrule the threshold is 1, so one stall pauses", () => {
    expect(core.thresholdFor("M1", "M1")).toBe(1);
    expect(core.thresholdFor("M1", "M2")).toBe(core.MAX_STALLED_SESSIONS);
    expect(core.thresholdFor("M1", null)).toBe(core.MAX_STALLED_SESSIONS);

    expect(walk(playbook(["| M1 | Parser | `pending` | | |"]), { resumedAt: "M1" })).toEqual([
      "run:M1",
      "pause:stall:M1",
    ]);
  });

  it("E12 — a vanished row is judged by doneCount, never by an exception", () => {
    const content = playbook(["| M1 | Parser | `pending` | | |"]);
    const base = loop(content, { stalls: 1 });

    const progressed = core.foldOutcome(base, {
      rowId: "M1a",
      statusAfter: null,
      doneCountBefore: 0,
      doneCountAfter: 1,
      repoChanged: true,
      finalMessage: null,
    });
    expect(progressed.stalls).toBe(0);

    const stalled = core.foldOutcome(base, {
      rowId: "M1a",
      statusAfter: null,
      doneCountBefore: 1,
      doneCountAfter: 1,
      repoChanged: false,
      finalMessage: null,
    });
    expect(stalled.stalls).toBe(2);
  });

  it("sizes the session cap as unfinished agent rows x threshold + slack", () => {
    const content = playbook(
      [
        "| M1 | Parser | `agent` | `done` | abc123 | |",
        "| M2 | Loop | `agent` | `pending` | | |",
        "| M3 | Prompts | `agent` | `in_progress` | | |",
        "| G1 | Operator merges | `operator` | `pending` | | |",
      ],
      { owner: true },
    );
    const table = parse(content, "04_execute.md");
    expect(core.sessionCap(table)).toBe(2 * core.MAX_STALLED_SESSIONS + core.SESSION_CAP_SLACK);
  });

  it("an empty-but-finished table still allows the slack sessions", () => {
    const table = parse(playbook(["| M1 | Parser | `done` | abc123 | |"]), "04_execute.md");
    expect(core.sessionCap(table)).toBe(core.SESSION_CAP_SLACK);
  });

  it("a fully done table completes", () => {
    expect(walk(playbook(["| M1 | Parser | `done` | abc123 | |"]))).toEqual(["complete"]);
  });
});

// --- The driver -------------------------------------------------------------------------------

describe("handleExecute — the driver", () => {
  it("advances to ai_qa when every row is done, and never to fine_tuning", async () => {
    files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `done` | abc123 | |"]));

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    expect(mockRunAndStream).not.toHaveBeenCalled();
    expect(mockUpdateStage).toHaveBeenCalledWith(
      path.join(CTX.cwd, CTX.planPath),
      "ai_qa",
    );
    expect(mockUpdateStage).not.toHaveBeenCalledWith(expect.anything(), "fine_tuning");
  });

  it("AC3 — runs no session at all for a planned gate, and uses the plan's checklist", async () => {
    files.set(
      PLAYBOOK_PATH,
      playbook(
        [
          "| G1 | Operator merges PRs #12 and #14 | `operator` | `pending` | | |",
          "| M9 | Build on the merge | `agent` | `pending` | | |",
        ],
        { owner: true },
      ),
    );
    files.set(
      PLAN_PATH,
      [
        "## G1 — Operator merges PRs #12 and #14",
        "",
        "- [ ] Open PRs against `main` in order #12 -> #14",
        "- [ ] Merge both PRs",
        "",
        "**Verification:** `git merge-base --is-ancestor <each branch> origin/main`",
        "",
        "## M9 — Build on the merge",
        "",
        "- [ ] Not an operator item",
        "",
      ].join("\n"),
    );

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    expect(mockRunAndStream).not.toHaveBeenCalled();
    expect(mockUpdateStage).not.toHaveBeenCalled();
    expect(mockPauseForOperator).toHaveBeenCalledWith(
      path.join(CTX.cwd, CTX.planPath),
      expect.objectContaining({ milestone: "G1" }),
    );

    const written = files.get(PLAYBOOK_PATH)!;
    const block = lastBlock(written);
    expect(block).toContain("Open PRs against `main` in order #12 -> #14");
    expect(block).toContain("Merge both PRs");
    expect(block).toContain("git merge-base --is-ancestor");
    expect(block).toContain("Operator actions complete — resume execution");
    expect(block).not.toContain("- [ ] Not an operator item");
    expect(written).toContain("| G1 | Operator merges PRs #12 and #14 | `operator` | `needs_operator` |");
  });

  it("AC17 — repoChanged picks the stall wording: committed but did not finish", async () => {
    files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `pending` | | |"]));
    mockRepoSnapshot
      .mockResolvedValueOnce({ head: "head0", dirtyFiles: [] })
      .mockResolvedValueOnce({ head: "head1", dirtyFiles: [] })
      .mockResolvedValueOnce({ head: "head1", dirtyFiles: [] })
      .mockResolvedValueOnce({ head: "head2", dirtyFiles: [] });

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    const block = lastBlock(files.get(PLAYBOOK_PATH)!);
    expect(block).toContain("committed work but did not finish this milestone");
    expect(block).not.toContain("made no changes to the repository");
  });

  it("AC17 — an untouched repository gets the other sentence", async () => {
    files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `pending` | | |"]));
    mockRepoSnapshot.mockResolvedValue({ head: "head0", dirtyFiles: ["src/a.ts"] });

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    const block = lastBlock(files.get(PLAYBOOK_PATH)!);
    expect(block).toContain("made no changes to the repository");
    expect(block).not.toContain("committed work but did not finish this milestone");
  });

  it("AC13 — a playbook with no Owner column gets the legacy note on a stall", async () => {
    files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `pending` | | |"]));

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    expect(lastBlock(files.get(PLAYBOOK_PATH)!)).toContain(
      "This playbook predates operator gates",
    );
  });

  it("AC13 — a playbook that already has an Owner column does not get that note", async () => {
    files.set(
      PLAYBOOK_PATH,
      playbook(["| M1 | Parser | `agent` | `pending` | | |"], { owner: true }),
    );

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    expect(lastBlock(files.get(PLAYBOOK_PATH)!)).not.toContain(
      "This playbook predates operator gates",
    );
  });

  it("records the pause in state.yml with the milestone and a one-line reason", async () => {
    files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `pending` | | |"]));

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    expect(mockPauseForOperator).toHaveBeenCalledWith(path.join(CTX.cwd, CTX.planPath), {
      milestone: "M1",
      reason: "M1 — no progress in 2 sessions",
    });
    expect(mockReadState().operator_reason).toBe("M1 — no progress in 2 sessions");
  });

  it("writes state before it commits, so a paused task leaves a clean tree", async () => {
    files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `pending` | | |"]));
    const order: string[] = [];
    mockPauseForOperator.mockImplementation(() => {
      order.push("state");
    });
    mockCommitAll.mockImplementation((_git: unknown, message: string) => {
      if (message.includes("paused for operator")) order.push("commit");
      return Promise.resolve("abc123");
    });

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    expect(order).toEqual(["state", "commit"]);
  });

  it("AC12 — an unparsable table throws, and ai_qa is never written", async () => {
    files.set(
      PLAYBOOK_PATH,
      ["# Execution Playbook", "", "No status heading here at all.", ""].join("\n"),
    );

    const { handleExecute } = await loadHandler();
    await expect(handleExecute(CTX)).rejects.toThrow(/Execution Status/);

    expect(mockUpdateStage).not.toHaveBeenCalled();
    expect(mockRunAndStream).not.toHaveBeenCalled();
  });

  it("AC12 — a table that breaks mid-run throws instead of reading as complete", async () => {
    files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `pending` | | |"]));
    mockRunAndStream.mockImplementation(() => {
      files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `almost` | | |"]));
      return Promise.resolve("done-ish");
    });

    const { handleExecute } = await loadHandler();
    await expect(handleExecute(CTX)).rejects.toThrow(/Unknown milestone status "almost"/);

    expect(mockUpdateStage).not.toHaveBeenCalled();
  });

  it("clears resumed_at once the resumed row reaches done", async () => {
    state.resumed_at = "M1";
    files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `pending` | | |"]));
    mockRunAndStream.mockImplementation(() => {
      files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `done` | abc123 | |"]));
      return Promise.resolve("finished");
    });

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    expect(mockClearResumedAt).toHaveBeenCalledWith(path.join(CTX.cwd, CTX.planPath));
    expect(mockRunAndStream).toHaveBeenCalledTimes(1);
  });

  it("does not clear resumed_at when the resumed row stalls — and pauses after one session", async () => {
    state.resumed_at = "M1";
    files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `pending` | | |"]));

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    expect(mockClearResumedAt).not.toHaveBeenCalled();
    expect(mockRunAndStream).toHaveBeenCalledTimes(1);
    const block = lastBlock(files.get(PLAYBOOK_PATH)!);
    expect(block).toContain("M1 again");
  });

  it("normalises the agent's own block in place instead of appending a second one", async () => {
    files.set(PLAYBOOK_PATH, playbook(["| M1 | Parser | `pending` | | |"]));
    mockRunAndStream.mockImplementation(() => {
      const agentBlock = [
        "",
        "## Operator actions — pause 4 (M1)",
        "",
        "**Why paused:** the deploy key for staging is missing.",
        "",
        "- [x] Add the deploy key to the CI secret store",
        "",
        "**Agent will verify on resume:** `ssh -T git@staging`",
        "",
        `- [x] ${"Operator actions complete — resume execution"}`,
        "",
        "When done, switch back to branch `wrong-branch`, tick every box above and run `vibe-racer drive`.",
        "",
      ].join("\n");
      files.set(
        PLAYBOOK_PATH,
        playbook(["| M1 | Parser | `needs_operator` | | |"]) + agentBlock,
      );
      return Promise.resolve("I stopped at M1");
    });

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    const written = files.get(PLAYBOOK_PATH)!;
    expect(written.match(/^## Operator actions — pause /gm)?.length).toBe(1);

    const block = lastBlock(written);
    expect(block).toContain("## Operator actions — pause 1 (M1)");
    expect(block).toContain("- [ ] Add the deploy key to the CI secret store");
    expect(block).not.toContain("- [x]");
    expect(block).toContain(CTX.branchName);
    expect(block).not.toContain("wrong-branch");
    expect(mockPauseForOperator).toHaveBeenCalledWith(path.join(CTX.cwd, CTX.planPath), {
      milestone: "M1",
      reason: "the deploy key for staging is missing.",
    });
  });

  it("AC5 — the session cap ends the drive with a pause, not an error", async () => {
    files.set(
      PLAYBOOK_PATH,
      playbook([
        "| M1 | Parser | `pending` | | |",
        "| M2 | Loop | `pending` | | |",
      ]),
    );
    // Every session moves the repository but never a row: the stall path pauses at M1 first,
    // so force the cap by making each session hand the loop a fresh row to chew on.
    let n = 0;
    mockRunAndStream.mockImplementation(() => {
      n++;
      files.set(
        PLAYBOOK_PATH,
        playbook([
          `| M1_${n} | Parser | \`pending\` | | |`,
          "| M2 | Loop | `pending` | | |",
        ]),
      );
      return Promise.resolve(`session ${n}`);
    });

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    // cap = 2 unfinished agent rows x 2 + 2 slack.
    expect(mockRunAndStream).toHaveBeenCalledTimes(6);
    expect(mockReadState().stage).toBe("need_operator");
    const block = lastBlock(files.get(PLAYBOOK_PATH)!);
    expect(block).toContain("this is a safety limit");
    expect(block).not.toMatch(/error|failed/i);
  });

  it("D11 — trailing operator rows complete the lap and are announced, not run", async () => {
    files.set(
      PLAYBOOK_PATH,
      playbook(
        [
          "| M1 | Parser | `agent` | `done` | abc123 | |",
          "| G9 | Merge PR #2 | `operator` | `pending` | | |",
        ],
        { owner: true },
      ),
    );

    const { handleExecute } = await loadHandler();
    await handleExecute(CTX);

    expect(mockRunAndStream).not.toHaveBeenCalled();
    expect(mockPauseForOperator).not.toHaveBeenCalled();
    expect(mockUpdateStage).toHaveBeenCalledWith(
      path.join(CTX.cwd, CTX.planPath),
      "ai_qa",
    );

    const { log } = await import("../../../src/utils/logger.js");
    const lines = (log.info as unknown as { mock: { calls: string[][] } }).mock.calls.map(
      (c) => c[0],
    );
    expect(lines.some((l) => l.includes("G9 — Merge PR #2"))).toBe(true);
  });
});
