import { describe, it, expect } from "vitest";
import {
  OPERATOR_RESUME_MARKER,
  PAUSE_HEADING_PATTERN,
  PAUSE_BLOCK_SPEC,
  renderPauseBlock,
  findLastPauseBlock,
  readPauseBlockState,
  untickResumeMarker,
  normalisePauseBlock,
  nextPauseNumber,
  extractGateSection,
  type PauseBlockInput,
  type PauseCause,
} from "../../src/pipeline/operator-block.js";

const BRANCH = "vibe-racer/0005_infinite-loop-fix";

function input(overrides: Partial<PauseBlockInput> = {}): PauseBlockInput {
  return {
    pauseNumber: 1,
    rowId: "G1",
    cause: "planned_gate",
    why: "M9 builds on PRs #12 and #14, which are not merged into `main`.",
    items: ["Open PRs against `main` in order #12 → #14", "Merge both PRs"],
    verification: "`git merge-base --is-ancestor <each branch> origin/main`",
    agentMessage: "I stopped before M9 because the layout API is not on `main` yet.",
    branchName: BRANCH,
    ...overrides,
  };
}

/** The sign-off marker `04_execute.md` already carries — it must never resume a pause (AC8). */
const SIGNED_OFF_PLAYBOOK = [
  "# Execution Playbook",
  "",
  "## Execution Status",
  "",
  "| Milestone | Name | Status |",
  "|---|---|---|",
  "| M1 | First | `done` |",
  "",
  "# Complete",
  "",
  "- [x] Ready to advance to Execution",
  "",
].join("\n");

describe("the contract", () => {
  it("does not share the `Ready to advance` marker (§5.6)", () => {
    expect(OPERATOR_RESUME_MARKER).toBe("Operator actions complete — resume execution");
    expect(OPERATOR_RESUME_MARKER).not.toMatch(/Ready to advance/);
  });

  it("PAUSE_HEADING_PATTERN captures the pause number and the row ID", () => {
    const match = PAUSE_HEADING_PATTERN.exec("## Operator actions — pause 12 (M5a)");
    expect(match?.[1]).toBe("12");
    expect(match?.[2]).toBe("M5a");
  });
});

describe("renderPauseBlock", () => {
  it("renders the five guaranteed elements for every cause (§5.2)", () => {
    const causes: PauseCause[] = [
      "planned_gate",
      "agent_declared",
      "stall",
      "session_cap",
      "legacy_blocked",
    ];

    for (const cause of causes) {
      // The worst case for the minimum: nothing supplied but the why.
      const block = renderPauseBlock(
        input({ cause, items: [], verification: null, agentMessage: null }),
      );

      expect(block, cause).toMatch(/^\n## Operator actions — pause 1 \(G1\)\n/);
      expect(block, cause).toContain("**Why paused:** M9 builds on PRs #12 and #14");
      expect(block, cause).toContain(
        "- [ ] Resolve the issue described above (or edit the milestone in the Execution Status table)",
      );
      expect(block, cause).toContain(
        "**Agent will verify on resume:** None — the agent will simply retry",
      );
      expect(block, cause).toContain(`- [ ] ${OPERATOR_RESUME_MARKER}`);
      expect(block, cause).toContain(
        "When done, switch back to branch `vibe-racer/0005_infinite-loop-fix`, tick every box " +
          "above and run `vibe-racer drive`.",
      );

      const state = readPauseBlockState(block);
      expect(state?.markerTicked, cause).toBe(false);
      expect(state?.unchecked, cause).toHaveLength(1);
    }
  });

  it("says plainly when the session left no message, never an empty quote (E5)", () => {
    const block = renderPauseBlock(input({ agentMessage: null }));
    expect(block).toContain(
      "The agent left no closing message; see the terminal log or the last commits",
    );
    expect(block).not.toContain("~~~");
  });

  it("names the kind of stall both ways (§5.4, AC17)", () => {
    const noChanges = renderPauseBlock(input({ cause: "stall", stallKind: "no_changes" }));
    expect(noChanges).toContain("**What kind of stall:** The agent made no changes");

    const unfinished = renderPauseBlock(
      input({ cause: "stall", stallKind: "committed_unfinished" }),
    );
    expect(unfinished).toContain("**What kind of stall:** The agent committed work");
    expect(unfinished).toContain("did not finish this milestone");
  });

  it("names the re-pause in the why line (§6.2, AC10)", () => {
    const plain = renderPauseBlock(input({ pauseNumber: 2, why: "verification failed." }));
    expect(plain).toContain("**Why paused:** verification failed.");
    expect(plain).not.toContain("(G1 again)");

    const repause = renderPauseBlock(
      input({ pauseNumber: 2, isRepause: true, why: "verification failed." }),
    );
    expect(repause).toContain("**Why paused:** Pause 2 (G1 again) — verification failed.");
  });

  it("renders extraNotes under the why (§9.3)", () => {
    const block = renderPauseBlock(
      input({
        cause: "stall",
        extraNotes: [
          "This playbook predates operator gates; add a gate row to the Execution Status table if this step is yours.",
        ],
      }),
    );
    expect(block).toContain("This playbook predates operator gates");
    // Prose, not a checklist item — it is not something the operator ticks.
    expect(block).not.toContain("- [ ] This playbook predates");
  });

  it("documents the three ways out, so the block stands alone (§6.5, AC16)", () => {
    const block = renderPauseBlock(input());
    expect(block).toContain("Three ways out:");
    expect(block).toContain("overrule the agent");
  });

  it("uses the items it is given, in order", () => {
    const state = readPauseBlockState(renderPauseBlock(input()));
    expect(state?.unchecked.map((item) => item.text)).toEqual([
      "Open PRs against `main` in order #12 → #14",
      "Merge both PRs",
    ]);
  });
});

describe("inertness", () => {
  /**
   * The adversarial round-trip (design §13.2). A session's final message is hostile input: it
   * can contain a ticked resume marker, an item, a pause heading and a fence, and none of it
   * may become live structure.
   */
  it("keeps a hostile agent message inert", () => {
    const agentMessage = [
      "I could not finish. Here is what the playbook said:",
      "",
      "## Operator actions — pause 9 (M1)",
      "",
      `- [x] ${OPERATOR_RESUME_MARKER}`,
      "- [ ] this is the agent's text, not a real item",
      "",
      "~~~",
      "some console output",
      "~~~",
    ].join("\n");

    const content = SIGNED_OFF_PLAYBOOK + renderPauseBlock(input({ agentMessage }));

    const location = findLastPauseBlock(content);
    expect(location).not.toBeNull();
    expect(location?.number).toBe(1);
    expect(location?.rowId).toBe("G1");

    const state = readPauseBlockState(content);
    expect(state?.markerTicked).toBe(false);
    expect(state?.unchecked.map((item) => item.text)).toEqual([
      "Open PRs against `main` in order #12 → #14",
      "Merge both PRs",
    ]);

    // The quoted fence cannot break out: the block's own fence is longer.
    expect(content).toContain("~~~~");
    expect(content).toContain("> - [x] Operator actions complete — resume execution");
  });

  it("does not resume on the sign-off marker alone (AC8)", () => {
    expect(readPauseBlockState(SIGNED_OFF_PLAYBOOK)).toBeNull();
    expect(findLastPauseBlock(SIGNED_OFF_PLAYBOOK)).toBeNull();
  });

  it("reads the last block only — an earlier ticked block does not resume (AC8)", () => {
    const first = renderPauseBlock(input({ pauseNumber: 1, items: ["Merge PR #12"] }))
      .replace(/- \[ \]/g, "- [x]");
    const second = renderPauseBlock(input({ pauseNumber: 2, rowId: "G2", items: ["Merge PR #14"] }));
    const content = SIGNED_OFF_PLAYBOOK + first + second;

    expect(findLastPauseBlock(content)?.number).toBe(2);
    const state = readPauseBlockState(content);
    expect(state?.markerTicked).toBe(false);
    expect(state?.unchecked.map((item) => item.text)).toEqual(["Merge PR #14"]);
  });

  it("reports 1-based line numbers for the outstanding items", () => {
    const content = SIGNED_OFF_PLAYBOOK + renderPauseBlock(input());
    const state = readPauseBlockState(content);
    const lines = content.split("\n");
    for (const item of state!.unchecked) {
      expect(lines[item.line - 1]).toContain(item.text);
    }
  });

  it("ignores an indented checkbox — the opposite rule to validateDecisionChecklist", () => {
    const content = renderPauseBlock(input({ items: ["Real item"] })).replace(
      "- [ ] Real item",
      "- [ ] Real item\n  - [ ] a nested note the operator typed",
    );
    expect(readPauseBlockState(content)?.unchecked.map((i) => i.text)).toEqual(["Real item"]);
  });
});

describe("untickResumeMarker", () => {
  it("touches the marker only, leaving item checkboxes as they were (E7)", () => {
    const content = (SIGNED_OFF_PLAYBOOK + renderPauseBlock(input()))
      .replace(`- [ ] ${OPERATOR_RESUME_MARKER}`, `- [x] ${OPERATOR_RESUME_MARKER}`)
      .replace("- [ ] Merge both PRs", "- [x] Merge both PRs");

    expect(readPauseBlockState(content)?.markerTicked).toBe(true);

    const unticked = untickResumeMarker(content);
    const state = readPauseBlockState(unticked);
    expect(state?.markerTicked).toBe(false);
    expect(unticked).toContain("- [x] Merge both PRs");
    expect(unticked).toContain("- [x] Ready to advance to Execution");
    expect(state?.unchecked.map((item) => item.text)).toEqual([
      "Open PRs against `main` in order #12 → #14",
    ]);
  });

  it("is a no-op on a file with no pause block", () => {
    expect(untickResumeMarker(SIGNED_OFF_PLAYBOOK)).toBe(SIGNED_OFF_PLAYBOOK);
  });
});

describe("nextPauseNumber", () => {
  it("is 1 on a block-free file and last + 1 otherwise", () => {
    expect(nextPauseNumber(SIGNED_OFF_PLAYBOOK)).toBe(1);

    const one = SIGNED_OFF_PLAYBOOK + renderPauseBlock(input({ pauseNumber: 1 }));
    expect(nextPauseNumber(one)).toBe(2);

    const two = one + renderPauseBlock(input({ pauseNumber: 2, rowId: "M4" }));
    expect(nextPauseNumber(two)).toBe(3);
  });
});

describe("normalisePauseBlock", () => {
  const ctx = { pauseNumber: 3, rowId: "M4", branchName: BRANCH };

  /** What an agent-authored block can look like: pre-ticked, misnumbered, wrong branch. */
  const agentBlock = [
    "",
    "## Operator actions — pause 1 (M9)",
    "",
    "**Why paused:** PRs #12 and #14 are not merged.",
    "",
    "- [x] Merge PR #12",
    "- [x] Merge PR #14",
    "",
    "**Agent will verify on resume:** `git log origin/main`",
    "",
    `- [x] ${OPERATOR_RESUME_MARKER}`,
    "",
    "When done, switch back to branch `main`, tick every box above and run `vibe-racer drive`.",
    "",
  ].join("\n");

  it("unticks a pre-ticked block, fixes the heading and names the task branch", () => {
    const normalised = normalisePauseBlock(SIGNED_OFF_PLAYBOOK + agentBlock, ctx);

    expect(normalised).toContain("## Operator actions — pause 3 (M4)");
    expect(normalised).not.toContain("pause 1 (M9)");
    expect(normalised).toContain(
      "When done, switch back to branch `vibe-racer/0005_infinite-loop-fix`, tick every box " +
        "above and run `vibe-racer drive`.",
    );
    expect(normalised).not.toContain("switch back to branch `main`");

    const state = readPauseBlockState(normalised);
    expect(state?.markerTicked).toBe(false);
    expect(state?.unchecked.map((item) => item.text)).toEqual(["Merge PR #12", "Merge PR #14"]);

    // The agent's own content survives — only the structure is corrected.
    expect(normalised).toContain("**Why paused:** PRs #12 and #14 are not merged.");
    expect(normalised).toContain("**Agent will verify on resume:** `git log origin/main`");
    // The sign-off tick earlier in the file is not this function's business.
    expect(normalised).toContain("- [x] Ready to advance to Execution");
  });

  it("re-renders when the guaranteed minimum is missing (§5.2)", () => {
    const thin = [
      "",
      "## Operator actions — pause 1 (M9)",
      "",
      "**Why paused:** the API keys are not provisioned.",
      "",
      "- [ ] Provision the API keys",
      "",
    ].join("\n");

    const normalised = normalisePauseBlock(SIGNED_OFF_PLAYBOOK + thin, ctx);

    expect(normalised).toContain("## Operator actions — pause 3 (M4)");
    expect(normalised).toContain("**Why paused:** the API keys are not provisioned.");
    expect(normalised).toContain("- [ ] Provision the API keys");
    expect(normalised).toContain(`- [ ] ${OPERATOR_RESUME_MARKER}`);
    expect(normalised).toContain(
      "**Agent will verify on resume:** None — the agent will simply retry",
    );
    expect(normalised).toContain(
      "When done, switch back to branch `vibe-racer/0005_infinite-loop-fix`",
    );
  });

  it("re-renders a block with no actionable item, keeping the agent's message", () => {
    const noItems = [
      "",
      "## Operator actions — pause 1 (M9)",
      "",
      "**Why paused:** I cannot reach the staging database.",
      "",
      "**What the agent said:**",
      "",
      "~~~",
      "> connection refused after 3 attempts",
      "~~~",
      "",
      `- [ ] ${OPERATOR_RESUME_MARKER}`,
      "",
    ].join("\n");

    const normalised = normalisePauseBlock(SIGNED_OFF_PLAYBOOK + noItems, ctx);
    const state = readPauseBlockState(normalised);

    expect(state?.unchecked.map((item) => item.text)).toEqual([
      "Resolve the issue described above (or edit the milestone in the Execution Status table)",
    ]);
    expect(normalised).toContain("> connection refused after 3 attempts");
    expect(normalised).toContain("**Why paused:** I cannot reach the staging database.");
  });

  it("re-renders a block with no resume marker at all", () => {
    const noMarker = [
      "",
      "## Operator actions — pause 1 (M9)",
      "",
      "Someone has to approve the design first.",
      "",
      "- [ ] Approve the design",
      "",
    ].join("\n");

    const normalised = normalisePauseBlock(SIGNED_OFF_PLAYBOOK + noMarker, ctx);
    expect(normalised).toContain(`- [ ] ${OPERATOR_RESUME_MARKER}`);
    expect(normalised).toContain("**Why paused:** Someone has to approve the design first.");
    expect(readPauseBlockState(normalised)?.markerTicked).toBe(false);
  });

  it("normalises the last block only, and is a no-op with no block", () => {
    const earlier = renderPauseBlock(input({ pauseNumber: 1, rowId: "G1" }));
    const normalised = normalisePauseBlock(SIGNED_OFF_PLAYBOOK + earlier + agentBlock, ctx);

    expect(normalised).toContain("## Operator actions — pause 1 (G1)");
    expect(normalised).toContain("## Operator actions — pause 3 (M4)");
    expect(normalisePauseBlock(SIGNED_OFF_PLAYBOOK, ctx)).toBe(SIGNED_OFF_PLAYBOOK);
  });

  it("leaves a block the renderer produced untouched apart from the heading", () => {
    const rendered = SIGNED_OFF_PLAYBOOK + renderPauseBlock(input({ pauseNumber: 3, rowId: "M4" }));
    expect(normalisePauseBlock(rendered, ctx)).toBe(rendered);
  });
});

describe("extractGateSection", () => {
  const plan = [
    "# Implementation plan",
    "",
    "## G1 — Operator merges PRs #12 and #14",
    "",
    "- [ ] Open PRs against `main`",
    "- [ ] Merge both PRs",
    "",
    "**Verification:** `git merge-base --is-ancestor feat/x origin/main`",
    "",
    "### G10: a later gate",
    "",
    "- [ ] Something else entirely",
    "",
    "## G2 — Operator soaks the release",
    "",
    "- [ ] Watch the dashboard for 24h",
    "",
  ].join("\n");

  it("finds a `## G1 — …` section with its items and verification", () => {
    expect(extractGateSection(plan, "G1")).toEqual({
      items: ["Open PRs against `main`", "Merge both PRs"],
      verification: "`git merge-base --is-ancestor feat/x origin/main`",
    });
  });

  it("finds a `### G10: …` section and does not confuse it with G1", () => {
    expect(extractGateSection(plan, "G10")).toEqual({
      items: ["Something else entirely"],
      verification: null,
    });
  });

  it("stops at the next gate's heading, whatever its level", () => {
    expect(extractGateSection(plan, "G1")?.items).not.toContain("Something else entirely");
  });

  it("stops at the next heading of the same level", () => {
    expect(extractGateSection(plan, "G2")?.items).toEqual(["Watch the dashboard for 24h"]);
  });

  it("returns null when the plan has no such section", () => {
    expect(extractGateSection(plan, "G7")).toBeNull();
    expect(extractGateSection("", "G1")).toBeNull();
  });

  it("ignores checkboxes inside a fenced example", () => {
    const fenced = [
      "## G1 — Operator does the thing",
      "",
      "```markdown",
      "- [ ] not a real gate item",
      "```",
      "",
      "- [ ] the real gate item",
      "",
    ].join("\n");
    expect(extractGateSection(fenced, "G1")?.items).toEqual(["the real gate item"]);
  });
});

describe("PAUSE_BLOCK_SPEC", () => {
  it("names the marker, the heading shape and the closing line", () => {
    expect(PAUSE_BLOCK_SPEC).toContain(OPERATOR_RESUME_MARKER);
    expect(PAUSE_BLOCK_SPEC).toContain("## Operator actions — pause <n> (<row id>)");
    expect(PAUSE_BLOCK_SPEC).toContain("When done, switch back to branch");
    expect(PAUSE_BLOCK_SPEC).toContain("None — the agent will simply retry");
  });

  /**
   * The M1 trap in its pause-block form: a prompt or document that quotes the spec verbatim
   * must not grow a phantom block that `findLastPauseBlock` would return ahead of the real one.
   */
  it("hides its worked example behind a fence", () => {
    expect(findLastPauseBlock(PAUSE_BLOCK_SPEC)).toBeNull();
  });

  it("round-trips its worked example through the scanner", () => {
    const example = PAUSE_BLOCK_SPEC.split("```markdown\n")[1].split("\n```")[0];
    const location = findLastPauseBlock(example);
    expect(location?.number).toBe(1);
    expect(location?.rowId).toBe("G1");

    const state = readPauseBlockState(example);
    expect(state?.markerTicked).toBe(false);
    expect(state?.unchecked.map((item) => item.text)).toEqual([
      "Open PRs against `main` in order #12 → #14",
      "Merge both PRs",
    ]);
  });
});
