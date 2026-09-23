import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseExecutionStatus,
  setMilestoneStatus,
  firstUnfinished,
  rowStatus,
  operatorGates,
  trailingOperatorRows,
  pendingAgentRows,
  doneCount,
  hasOwnerColumn,
  ExecutionTableError,
  MILESTONE_STATUSES,
  OWNERS,
  EXECUTION_TABLE_SPEC,
  EXECUTION_STATUS_HEADING,
  EXECUTION_PLAYBOOK_FILE,
} from "../../src/pipeline/execute-table.js";

import { scanLines } from "../../src/pipeline/markdown-scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Fixtures are snapshots. Tests never read `plans/` at run time: a consumer repo has different
 *  plans, and this very task appends pause blocks to its own playbook. */
function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "../fixtures/playbooks", name), "utf-8");
}

/** A minimal well-formed section, so a test can state only the rows it cares about. */
function table(rows: string[], headers = "| Milestone | Name | Status | Commit | Notes |"): string {
  const width = (headers.match(/\|/g) || []).length - 1;
  return [
    "## Execution Status",
    "",
    headers,
    `|${"---|".repeat(width)}`,
    ...rows,
    "",
  ].join("\n");
}

describe("the contract", () => {
  it("has no `blocked` member — it is a read alias only", () => {
    expect(MILESTONE_STATUSES).toEqual(["pending", "in_progress", "done", "needs_operator"]);
    expect(MILESTONE_STATUSES as readonly string[]).not.toContain("blocked");
    expect(OWNERS).toEqual(["agent", "operator"]);
    expect(EXECUTION_STATUS_HEADING).toBe("Execution Status");
    expect(EXECUTION_PLAYBOOK_FILE).toBe("04_execute.md");
  });

  it("a row is a gate by Owner, never by how its ID is spelled", () => {
    // An operator row whose ID is not gate-shaped is still a gate.
    const parsed = parseExecutionStatus(
      table(
        ["| M1 | Ship | `operator` | `pending` |", "| M2 | After | `agent` | `pending` |"],
        "| Milestone | Name | Owner | Status |",
      ),
    );
    expect(operatorGates(parsed).map((r) => r.id)).toEqual(["M1"]);
  });
});

describe("parseExecutionStatus — real playbooks", () => {
  it("parses plans/0002 (no Owner column, em-dash cells)", () => {
    const parsed = parseExecutionStatus(fixture("0002-status.md"));
    expect(parsed.rows.map((r) => r.id)).toEqual(["M1", "M2", "M3"]);
    expect(parsed.rows.map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(parsed.rows[0].name).toBe("Extract `createPlanFolder()`");
    expect(parsed.rows[0].commit).toBeUndefined();
    expect(parsed.rows[0].notes).toBeUndefined();
    expect(hasOwnerColumn(parsed)).toBe(false);
    expect(parsed.rows.every((r) => r.owner === "agent")).toBe(true);
  });

  it("parses plans/0003 (full-width alignment row, prose Notes)", () => {
    const parsed = parseExecutionStatus(fixture("0003-status.md"));
    expect(parsed.rows.map((r) => r.id)).toEqual(["M1", "M2"]);
    expect(parsed.rows[0].notes).toBe("3 source files + 2 deletions");
    expect(parsed.rows[1].commit).toBe("251ba27");
    expect(parsed.rows[1].name).toBe("Un-export internals + test refactors");
  });

  it("parses plans/0004 — `M5a`/`M5b` IDs and Notes holding inline code and quotes", () => {
    const parsed = parseExecutionStatus(fixture("0004-status.md"));
    expect(parsed.rows.map((r) => r.id)).toEqual(["M1", "M2", "M3", "M4", "M5a", "M5b", "M6"]);
    expect(parsed.rows.every((r) => r.status === "done")).toBe(true);

    const m5a = parsed.rows.find((r) => r.id === "M5a")!;
    expect(m5a.notes).toContain("`multiply()`");
    expect(m5a.notes).toContain('"What doesn\'t"');
    expect(m5a.notes).toContain("`04_execute.md` line 69 shows M6 as `in_progress`");

    const m6 = parsed.rows.find((r) => r.id === "M6")!;
    expect(m6.commit).toBe("74dbb60");
    expect(m6.notes).toContain("ensureCompletionSection");
  });

  it("every real fixture reports zero unfinished work", () => {
    for (const name of ["0002-status.md", "0003-status.md", "0004-status.md"]) {
      const parsed = parseExecutionStatus(fixture(name));
      expect(firstUnfinished(parsed), name).toBeNull();
      expect(pendingAgentRows(parsed), name).toEqual([]);
      expect(doneCount(parsed), name).toBe(parsed.rows.length);
    }
  });
});

describe("parseExecutionStatus — tolerance", () => {
  it("accepts any case, backticks, bold, whitespace and extra columns", () => {
    const content = [
      "### execution status",
      "",
      "|  **Milestone**  | `Name` | Status | Risk | NOTES |",
      "|---|---|---|---|---|",
      "|   M1   |  Parser |  **Done**   | low | fine |",
      "| M2 | Driver | `IN_PROGRESS` | high | |",
      "| M3 | Docs | Pending | — | — |",
    ].join("\n");
    const parsed = parseExecutionStatus(content);
    expect(parsed.rows.map((r) => r.status)).toEqual(["done", "in_progress", "pending"]);
    expect(parsed.rows[0].name).toBe("Parser");
    expect(parsed.rows[2].notes).toBeUndefined();
  });

  it("tolerates a missing alignment row", () => {
    const parsed = parseExecutionStatus(
      ["## Execution Status", "", "| Milestone | Status |", "| M1 | `pending` |"].join("\n"),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].status).toBe("pending");
  });

  it("honours escaped pipes and pipes inside backtick spans", () => {
    const parsed = parseExecutionStatus(
      table([
        "| M1 | Parser | `done` | | Run `a | b` then `c` |",
        "| M2 | Driver | `pending` | | Either a \\| b |",
      ]),
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].notes).toBe("Run `a | b` then `c`");
    expect(parsed.rows[1].notes).toBe("Either a | b");
  });

  it("resolves columns by header name, not position", () => {
    const parsed = parseExecutionStatus(
      table(
        ["| `done` | operator | M1 | Parser |"],
        "| Status | Owner | Milestone | Name |",
      ),
    );
    expect(parsed.columns).toMatchObject({ status: 0, owner: 1, milestone: 2, name: 3 });
    expect(parsed.rows[0]).toMatchObject({ id: "M1", name: "Parser", owner: "operator" });
  });
});

describe("parseExecutionStatus — owner resolution", () => {
  it("defaults empty, em-dash and `agent` cells to agent", () => {
    const parsed = parseExecutionStatus(
      table(
        [
          "| M1 | A | | `pending` |",
          "| M2 | B | — | `pending` |",
          "| M3 | C | `agent` | `pending` |",
          "| G1 | D | **Operator** | `pending` |",
          "| M4 | E | `agent` | `pending` |",
        ],
        "| Milestone | Name | Owner | Status |",
      ),
    );
    expect(parsed.rows.map((r) => r.owner)).toEqual([
      "agent",
      "agent",
      "agent",
      "operator",
      "agent",
    ]);
    expect(hasOwnerColumn(parsed)).toBe(true);
  });
});

describe("parseExecutionStatus — legacy `blocked` (AC11)", () => {
  it("reads `blocked` as needs_operator and flags the row", () => {
    const parsed = parseExecutionStatus(fixture("legacy-blocked.md"));
    const m2 = parsed.rows.find((r) => r.id === "M2")!;
    expect(m2.status).toBe("needs_operator");
    expect(m2.legacyBlocked).toBe(true);
    expect(parsed.rows.filter((r) => r.legacyBlocked)).toHaveLength(1);
    expect(firstUnfinished(parsed)!.id).toBe("M2");
  });
});

describe("parseExecutionStatus — throws (AC12: message quality)", () => {
  it("names the file and the required heading when there is no heading", () => {
    try {
      parseExecutionStatus(fixture("no-heading.md"), "plans/0007_x/04_execute.md");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExecutionTableError);
      const e = err as ExecutionTableError;
      expect(e.message).toContain("plans/0007_x/04_execute.md");
      expect(e.message).toContain('"Execution Status"');
      expect(e.file).toBe("plans/0007_x/04_execute.md");
    }
  });

  it("names the file and the heading's line when there is no table", () => {
    const content = ["# Playbook", "", "## Execution Status", "", "Nothing here yet.", ""].join(
      "\n",
    );
    try {
      parseExecutionStatus(content);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as ExecutionTableError;
      expect(e.message).toContain("No table found");
      expect(e.message).toContain("04_execute.md");
      expect(e.message).toContain("heading at line 3");
      expect(e.line).toBe(3);
    }
  });

  it("names every candidate table when none resolves both columns", () => {
    const content = [
      "## Execution Status",
      "",
      "| CP | After | Status |",
      "|---|---|---|",
      "| CP1 | M2 | `pending` |",
      "",
      "| Milestone | Name |",
      "|---|---|",
      "| M1 | Parser |",
      "",
    ].join("\n");
    try {
      parseExecutionStatus(content);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as ExecutionTableError;
      expect(e.message).toContain("Milestone column");
      expect(e.message).toContain("Status column");
      expect(e.message).toContain("header at line 3 with headers: CP, After, Status");
      expect(e.message).toContain("header at line 7 with headers: Milestone, Name");
    }
  });

  it("names the header line when the table has zero data rows", () => {
    const content = [
      "## Execution Status",
      "",
      "| Milestone | Name | Status |",
      "|---|---|---|",
      "",
    ].join("\n");
    try {
      parseExecutionStatus(content);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as ExecutionTableError;
      expect(e.message).toContain("no milestone rows");
      expect(e.message).toContain("header at line 3");
      expect(e.line).toBe(3);
    }
  });

  it("names the line, the value, the legal values and who fixes it on an unknown status", () => {
    try {
      parseExecutionStatus(fixture("unknown-status.md"), "plans/0007_x/04_execute.md");
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as ExecutionTableError;
      expect(e.message).toContain('"almost"');
      expect(e.message).toContain("plans/0007_x/04_execute.md");
      expect(e.message).toContain("line 8");
      expect(e.message).toContain("pending, in_progress, done, needs_operator");
      expect(e.message).toContain("by hand");
      expect(e.message).toContain("needs_operator");
      expect(e.line).toBe(8);
    }
  });

  it("names the line and the value on an unknown owner (D3 — never defaults to agent)", () => {
    const content = table(
      ["| M1 | Parser | `agent` | `pending` |", "| M2 | Driver | `humam` | `pending` |"],
      "| Milestone | Name | Owner | Status |",
    );
    try {
      parseExecutionStatus(content);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as ExecutionTableError;
      expect(e.message).toContain('"humam"');
      expect(e.message).toContain("line 6");
      expect(e.message).toContain("agent | operator");
      expect(e.line).toBe(6);
    }
  });
});

describe("parseExecutionStatus — nothing outside the chosen table is read", () => {
  it("ignores `pending` in a Milestone Summary table and in prose (E3)", () => {
    const parsed = parseExecutionStatus(fixture("pending-in-summary-only.md"));
    expect(parsed.rows.map((r) => r.id)).toEqual(["M1", "M2", "M3"]);
    expect(parsed.rows.every((r) => r.status === "done")).toBe(true);
    expect(firstUnfinished(parsed)).toBeNull();
    expect(pendingAgentRows(parsed)).toEqual([]);
    // The summary table above the heading is operator-owned; none of it leaks in.
    expect(hasOwnerColumn(parsed)).toBe(false);
    expect(operatorGates(parsed)).toEqual([]);
  });

  it("skips a foreign table under the same heading, not an error (D8)", () => {
    const parsed = parseExecutionStatus(fixture("two-tables.md"));
    expect(parsed.rows.map((r) => r.id)).toEqual(["M1", "M2", "M3"]);
    expect(parsed.rows.some((r) => r.id.startsWith("CP"))).toBe(false);
    expect(firstUnfinished(parsed)!.id).toBe("M2");
  });

  it("throws, naming the checkpoint table, once the milestone table is removed", () => {
    const stripped = fixture("two-tables.md")
      .split("\n")
      .filter((line) => !/^\|\s*(Milestone|M\d)\b/.test(line) && !/^\|---\|/.test(line.trim()))
      .join("\n");
    try {
      parseExecutionStatus(stripped);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as ExecutionTableError;
      expect(e.message).toContain("Candidate tables:");
      expect(e.message).toMatch(/header at line \d+ with headers: CP, After, Status, Approved by the human/);
    }
  });
});

describe("setMilestoneStatus", () => {
  const content = fixture("legacy-blocked.md");

  it("rewrites only the status cell, byte-preserving the rest of the line", () => {
    const before = content.split("\n");
    const after = setMilestoneStatus(content, "M3", "done").split("\n");
    expect(after).toHaveLength(before.length);
    after.forEach((line, i) => {
      if (i !== 8) expect(line, `line ${i}`).toBe(before[i]);
    });
    expect(before[8]).toBe("| M3 | Docs | `pending` | | |");
    expect(after[8]).toBe("| M3 | Docs | `done` | | |");
  });

  it("preserves the backtick wrapper and the cell's padding", () => {
    const padded = table(["| M1 | Parser |    `pending`   | | |"]);
    expect(setMilestoneStatus(padded, "M1", "needs_operator")).toContain(
      "| M1 | Parser |    `needs_operator`   | | |",
    );

    const bold = table(["| M1 | Parser | **pending** | | |"]);
    expect(setMilestoneStatus(bold, "M1", "done")).toContain("| M1 | Parser | **done** | | |");

    const bare = table(["| M1 | Parser | pending | | |"]);
    expect(setMilestoneStatus(bare, "M1", "done")).toContain("| M1 | Parser | done | | |");
  });

  it("is a no-op on an absent row — a hand edit must never break resume (AC9)", () => {
    expect(setMilestoneStatus(content, "M9", "done")).toBe(content);
    expect(setMilestoneStatus(content, "", "done")).toBe(content);
  });

  it("matches the row ID case-insensitively and round-trips through the parser", () => {
    const updated = setMilestoneStatus(fixture("two-tables.md"), "m2", "done");
    const parsed = parseExecutionStatus(updated);
    expect(rowStatus(parsed, "M2")).toBe("done");
    expect(firstUnfinished(parsed)!.id).toBe("M3");
  });
});

describe("derived queries", () => {
  const parsed = parseExecutionStatus(
    table(
      [
        "| M1 | Parser | `agent` | `done` |",
        "| M2 | Driver | `agent` | `in_progress` |",
        "| G1 | Operator merges #12 | `operator` | `pending` |",
        "| M3 | Docs | `agent` | `pending` |",
      ],
      "| Milestone | Name | Owner | Status |",
    ),
  );

  it("firstUnfinished skips `done` and returns the first of anything else", () => {
    expect(firstUnfinished(parsed)!.id).toBe("M2");
    const allDone = parseExecutionStatus(fixture("0002-status.md"));
    expect(firstUnfinished(allDone)).toBeNull();
  });

  it("rowStatus answers for a present row and returns null for an absent one", () => {
    expect(rowStatus(parsed, "G1")).toBe("pending");
    expect(rowStatus(parsed, "M1")).toBe("done");
    expect(rowStatus(parsed, "M99")).toBeNull();
  });

  it("operatorGates and doneCount", () => {
    expect(operatorGates(parsed).map((r) => r.id)).toEqual(["G1"]);
    expect(doneCount(parsed)).toBe(1);
  });

  it("pendingAgentRows is every UNFINISHED agent row, not only `pending` (D9)", () => {
    expect(pendingAgentRows(parsed).map((r) => r.id)).toEqual(["M2", "M3"]);

    const resumed = parseExecutionStatus(
      table(
        [
          "| M1 | A | `agent` | `in_progress` |",
          "| M2 | B | `agent` | `needs_operator` |",
          "| G1 | C | `operator` | `pending` |",
          "| M3 | D | `agent` | `done` |",
        ],
        "| Milestone | Name | Owner | Status |",
      ),
    );
    expect(pendingAgentRows(resumed).map((r) => r.id)).toEqual(["M1", "M2"]);

    expect(pendingAgentRows(parseExecutionStatus(fixture("0004-status.md")))).toEqual([]);
  });
});

describe("trailingOperatorRows (D11)", () => {
  function rowsOf(specs: string[]): string {
    return table(
      specs.map((s) => {
        const [id, owner, status] = s.split(":");
        return `| ${id} | ${id} | \`${owner}\` | \`${status ?? "pending"}\` |`;
      }),
      "| Milestone | Name | Owner | Status |",
    );
  }

  it("is empty when a gate is followed by the milestone it unblocks", () => {
    const parsed = parseExecutionStatus(
      rowsOf(["M1:agent", "M2:agent", "G1:operator", "M3:agent"]),
    );
    expect(trailingOperatorRows(parsed)).toEqual([]);
  });

  it("returns every operator row after the last agent row", () => {
    const parsed = parseExecutionStatus(
      rowsOf(["M1:agent", "M2:agent", "G1:operator", "G2:operator"]),
    );
    expect(trailingOperatorRows(parsed).map((r) => r.id)).toEqual(["G1", "G2"]);
  });

  it("is empty on an all-agent table", () => {
    const parsed = parseExecutionStatus(rowsOf(["M1:agent", "M2:agent", "M3:agent"]));
    expect(trailingOperatorRows(parsed)).toEqual([]);
    expect(trailingOperatorRows(parseExecutionStatus(fixture("0003-status.md")))).toEqual([]);
  });

  it("still returns an already-`done` trailing operator row — position is the question", () => {
    const parsed = parseExecutionStatus(
      rowsOf(["M1:agent", "M2:agent:done", "G1:operator:done"]),
    );
    expect(trailingOperatorRows(parsed).map((r) => r.id)).toEqual(["G1"]);
  });
});

// Issue #1 from the QA report. The parser and `operator-block.ts` read the same file; until they
// shared `markdown-scan.ts` they disagreed about what a heading is, and the prompts shipped a
// worked example the agent could quote into the playbook to hijack the loop.
describe("parseExecutionStatus — fences and blockquotes are not the document", () => {
  it("skips a quoted contract and reads the operator's real table", () => {
    const parsed = parseExecutionStatus(fixture("fenced-decoy.md"));

    expect(parsed.rows.map((r) => r.id)).toEqual(["R1", "R2"]);
    expect(firstUnfinished(parsed)!.id).toBe("R2");
    // The decoy's gate must not become a pause at a gate that does not exist.
    expect(operatorGates(parsed)).toEqual([]);
  });

  it("writes the status cell into the real row, not the quoted example", () => {
    const written = setMilestoneStatus(fixture("fenced-decoy.md"), "R2", "done");

    expect(written).toContain("| R2 | The real second milestone | `agent` | `done` |");
    // Byte-identical example: the operator's own quoted contract is not the pipeline's to edit.
    expect(written).toContain("| M2 | Wire the parser into the loop | `agent` | `pending` | — | — |");
  });

  it("says the heading is fenced rather than claiming there is none", () => {
    const fenced = ["# Playbook", "", "```markdown", "## Execution Status", "", "| Milestone | Status |", "|---|---|", "| M1 | `pending` |", "```", ""].join("\n");

    try {
      parseExecutionStatus(fenced, "plans/0009_x/04_execute.md");
      expect.unreachable("a fenced heading is not a heading");
    } catch (e) {
      expect(e).toBeInstanceOf(ExecutionTableError);
      const error = e as ExecutionTableError;
      expect(error.message).toContain("inside a code fence or a blockquote");
      expect(error.line).toBe(4);
    }
  });

  it("ignores a fenced table under the real heading", () => {
    const content = [
      "## Execution Status",
      "",
      "The shape to follow:",
      "",
      "```markdown",
      "| Milestone | Status |",
      "|---|---|",
      "| EXAMPLE | `pending` |",
      "```",
      "",
      "| Milestone | Status |",
      "|---|---|",
      "| M1 | `done` |",
      "",
    ].join("\n");

    expect(parseExecutionStatus(content).rows.map((r) => r.id)).toEqual(["M1"]);
  });
});

describe("EXECUTION_TABLE_SPEC — the drift guard", () => {
  it("is built from the unions: every status and owner appears in it", () => {
    for (const status of MILESTONE_STATUSES) {
      expect(EXECUTION_TABLE_SPEC, status).toContain(`\`${status}\``);
    }
    for (const owner of OWNERS) {
      expect(EXECUTION_TABLE_SPEC, owner).toContain(`\`${owner}\``);
    }
    expect(EXECUTION_TABLE_SPEC).not.toContain("blocked");
  });

  it("states the gate rule and the post-execution counter-rule (D11)", () => {
    expect(EXECUTION_TABLE_SPEC).toContain("never because of how its ID is spelled");
    expect(EXECUTION_TABLE_SPEC).toMatch(/gate row must be followed by the milestone it unblocks/);
    expect(EXECUTION_TABLE_SPEC).toMatch(/Merge, tag, release and deploy/);
  });

  it("its worked example obeys the contract it teaches", () => {
    // The spec deliberately ships the example WITHOUT a heading (an agent that quotes the
    // contract into its playbook must not hand the loop a second table), so the heading the
    // parser needs is supplied here instead of shipped to every agent.
    const example = EXECUTION_TABLE_SPEC.slice(EXECUTION_TABLE_SPEC.indexOf("| Milestone | Name |"));
    const parsed = parseExecutionStatus(`## ${EXECUTION_STATUS_HEADING}\n\n${example}`);
    expect(parsed.rows.map((r) => r.id)).toEqual(["M1", "G1", "M2"]);
    expect(parsed.rows.map((r) => r.status)).toEqual(["done", "pending", "pending"]);
    expect(parsed.rows.map((r) => r.owner)).toEqual(["agent", "operator", "agent"]);
    expect(hasOwnerColumn(parsed)).toBe(true);
    expect(operatorGates(parsed).map((r) => r.id)).toEqual(["G1"]);
    expect(trailingOperatorRows(parsed)).toEqual([]);
    expect(firstUnfinished(parsed)!.id).toBe("G1");
  });

  // The spec ships inside both prompts, so a heading line here is a heading line the agent can
  // quote into its playbook — where it outranks the real table and takes the loop with it.
  it("ships no Execution Status heading of its own", () => {
    const headings = EXECUTION_TABLE_SPEC.split("\n").filter((line) =>
      new RegExp(`^#{1,6}\\s+.*${EXECUTION_STATUS_HEADING}`).test(line),
    );
    expect(headings).toEqual([]);
  });

  it("still shows the example rows, and shows them fenced", () => {
    expect(EXECUTION_TABLE_SPEC).toContain("| G1 | Operator merges PRs #12 and #14 |");

    // Belt and braces: no heading to copy (the loop takes the first one in the file), and the
    // rows are fenced, so even pasted under the operator's real heading they stay inert.
    const scanned = scanLines(EXECUTION_TABLE_SPEC.split("\n"));
    const exampleRow = scanned.find((line) => line.raw.startsWith("| G1 |"))!;
    expect(exampleRow.fenced).toBe(true);
  });
});
