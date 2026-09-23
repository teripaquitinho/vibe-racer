/**
 * The Execution Status table — what it legally contains, how to read it, and how to write a
 * single cell back.
 *
 * Pure by design: no `fs`, no `git`, no logging, and no imports from the pipeline or state
 * layers beyond `markdown-scan.ts`, a leaf module with no imports of its own. That purity is
 * what keeps this module mock-free under test and what lets `prompts.ts` interpolate
 * `EXECUTION_TABLE_SPEC` without creating a cycle.
 */

import { isHeading, isLive, scanLines, type ScannedLine } from "./markdown-scan.js";

export const MILESTONE_STATUSES = [
  "pending",
  "in_progress",
  "done",
  "needs_operator",
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const OWNERS = ["agent", "operator"] as const;
export type Owner = (typeof OWNERS)[number];

export const EXECUTION_STATUS_HEADING = "Execution Status";
export const EXECUTION_PLAYBOOK_FILE = "04_execute.md";

/**
 * `blocked` is not a member of the status union and never becomes one. It survives only as a
 * read alias so a playbook written by an earlier version still parses; the row is flagged
 * `legacyBlocked` so the caller can say where the pause came from.
 */
const LEGACY_STATUS_ALIASES: Record<string, MilestoneStatus> = {
  blocked: "needs_operator",
};

export interface MilestoneRow {
  /** "M9" | "G1" | "M5a" | whatever the operator wrote. Never validated. */
  id: string;
  name: string;
  /** Defaults to "agent" when there is no Owner column. */
  owner: Owner;
  status: MilestoneStatus;
  commit?: string;
  notes?: string;
  /** Absolute 0-based line in the file — `setMilestoneStatus` writes here. */
  lineIndex: number;
  /** This row literally said `blocked`. */
  legacyBlocked: boolean;
}

export interface ColumnMap {
  milestone: number;
  status: number;
  name?: number;
  /** Absent ⇒ every row is agent-owned. */
  owner?: number;
  commit?: number;
  notes?: number;
}

export interface ExecutionTable {
  rows: MilestoneRow[];
  /** Absolute 0-based line of the table's header row. */
  headerLineIndex: number;
  columns: ColumnMap;
}

export class ExecutionTableError extends Error {
  constructor(
    message: string,
    readonly file?: string,
    /** 1-based, as a human reads it. */
    readonly line?: number,
  ) {
    super(message);
    this.name = "ExecutionTableError";
  }
}

const HEADING_RE = /^#{1,6}\s+(.*)$/;
const ALIGNMENT_RE = /^\|[\s:|-]+\|$/;
const EMPTY_CELL_VALUES = new Set(["", "-", "—", "–"]);

const COLUMN_KEYS = [
  "milestone",
  "name",
  "owner",
  "status",
  "commit",
  "notes",
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];

interface CellSpan {
  start: number;
  end: number;
}

/**
 * Cell boundaries within a raw table line, honouring `\|` escapes and backtick spans.
 * A naive `line.split("|")` breaks on the real playbooks, whose Notes cells hold prose with
 * inline code.
 */
function splitRowSpans(line: string): CellSpan[] {
  const spans: CellSpan[] = [];
  let start = 0;
  let inCode = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      i++;
      continue;
    }
    if (ch === "`") {
      inCode = !inCode;
      continue;
    }
    if (ch === "|" && !inCode) {
      spans.push({ start, end: i });
      start = i + 1;
    }
  }
  spans.push({ start, end: line.length });

  // `| a | b |` produces an empty span before the first pipe and after the last one.
  if (spans.length > 1 && line.slice(spans[0].start, spans[0].end).trim() === "") {
    spans.shift();
  }
  const last = spans[spans.length - 1];
  if (spans.length > 1 && line.slice(last.start, last.end).trim() === "") {
    spans.pop();
  }
  return spans;
}

function splitRow(line: string): string[] {
  return splitRowSpans(line).map((s) => line.slice(s.start, s.end).replace(/\\\|/g, "|"));
}

/** trim → strip surrounding backticks → strip bold markers → trim, repeated until stable. */
function cleanCell(raw: string): string {
  let value = raw.trim();
  for (;;) {
    const before = value;
    if (value.length > 1 && value.startsWith("`") && value.endsWith("`")) {
      value = value.slice(1, -1).trim();
    }
    if (value.length > 4 && value.startsWith("**") && value.endsWith("**")) {
      value = value.slice(2, -2).trim();
    }
    if (value === before) return value;
  }
}

/** `cleanCell`, lowercased — the form used for matching headers and enum cells. */
function normaliseCell(raw: string): string {
  return cleanCell(raw).toLowerCase();
}

function isTableLine(line: string): boolean {
  return line.trim().startsWith("|");
}

function optionalCell(cells: string[], index: number | undefined): string | undefined {
  if (index === undefined) return undefined;
  const raw = cells[index];
  if (raw === undefined) return undefined;
  const value = cleanCell(raw);
  return EMPTY_CELL_VALUES.has(value) ? undefined : value;
}

function resolveColumns(headerLine: string): Partial<Record<ColumnKey, number>> {
  const headers = splitRow(headerLine).map(normaliseCell);
  const columns: Partial<Record<ColumnKey, number>> = {};
  headers.forEach((header, index) => {
    const key = COLUMN_KEYS.find((candidate) => candidate === header);
    if (key && columns[key] === undefined) columns[key] = index;
  });
  return columns;
}

interface TableBlock {
  headerLineIndex: number;
  /** Absolute 0-based line indices of the data rows, alignment row already dropped. */
  dataLineIndices: number[];
  columns: Partial<Record<ColumnKey, number>>;
  headers: string[];
}

/** Every pipe table under the heading, in document order. */
function collectTableBlocks(
  lines: string[],
  scanned: ScannedLine[],
  from: number,
  to: number,
): TableBlock[] {
  const blocks: TableBlock[] = [];
  // A `|` row inside a fence is a picture of a table, not a table — the same rule the heading
  // search above applies, so a fenced example under the real heading is inert too.
  const live = (i: number): boolean => isLive(scanned[i]) && isTableLine(lines[i]);
  let i = from;

  while (i < to) {
    if (!live(i)) {
      i++;
      continue;
    }
    const headerLineIndex = i;
    const dataLineIndices: number[] = [];
    i++;
    if (i < to && isLive(scanned[i]) && ALIGNMENT_RE.test(lines[i].trim())) i++;
    while (i < to && live(i)) {
      dataLineIndices.push(i);
      i++;
    }
    blocks.push({
      headerLineIndex,
      dataLineIndices,
      columns: resolveColumns(lines[headerLineIndex]),
      headers: splitRow(lines[headerLineIndex]).map((h) => cleanCell(h)),
    });
  }
  return blocks;
}

function describeCandidates(blocks: TableBlock[]): string {
  return blocks
    .map((block) => {
      const found = block.headers.filter((h) => h !== "").join(", ") || "(no headers)";
      return `header at line ${block.headerLineIndex + 1} with headers: ${found}`;
    })
    .join("; ");
}

function parseStatus(
  raw: string,
  file: string,
  lineIndex: number,
): { status: MilestoneStatus; legacyBlocked: boolean } {
  const value = normaliseCell(raw);
  const alias = LEGACY_STATUS_ALIASES[value];
  if (alias) return { status: alias, legacyBlocked: true };
  if ((MILESTONE_STATUSES as readonly string[]).includes(value)) {
    return { status: value as MilestoneStatus, legacyBlocked: false };
  }
  throw new ExecutionTableError(
    `Unknown milestone status "${cleanCell(raw)}" in ${file} at line ${lineIndex + 1}. ` +
      `Legal values are: ${MILESTONE_STATUSES.join(", ")}. ` +
      `This cell is yours to correct by hand — a milestone a human owns is needs_operator.`,
    file,
    lineIndex + 1,
  );
}

function parseOwner(
  cells: string[],
  columns: ColumnMap,
  file: string,
  lineIndex: number,
): Owner {
  if (columns.owner === undefined) return "agent";
  const value = normaliseCell(cells[columns.owner] ?? "");
  if (EMPTY_CELL_VALUES.has(value) || value === "agent") return "agent";
  if (value === "operator") return "operator";
  throw new ExecutionTableError(
    `Unknown milestone owner "${cleanCell(cells[columns.owner] ?? "")}" in ${file} ` +
      `at line ${lineIndex + 1}. Legal values are: agent | operator.`,
    file,
    lineIndex + 1,
  );
}

/**
 * Reads the Execution Status table out of a playbook.
 *
 * Nothing outside the chosen table is ever read: a `pending` in a Milestone Summary table or in
 * prose is inert. Under the heading, the first table that resolves BOTH a `Milestone` and a
 * `Status` column wins — a hand-written playbook may carry a checkpoint or sign-off table under
 * the same heading, and skipping it costs nothing.
 */
export function parseExecutionStatus(
  content: string,
  file: string = EXECUTION_PLAYBOOK_FILE,
): ExecutionTable {
  const lines = content.split("\n");
  const scanned = scanLines(lines);

  // Fence- and blockquote-aware, and it has to be: both prompts carry a worked example of this
  // very table, and a playbook that quotes the contract back would otherwise hand the loop a
  // table to execute — and `setMilestoneStatus`, which re-parses, a cell to rewrite inside it.
  let headingIndex = -1;
  let shadowedIndex = -1;
  for (const line of scanned) {
    const match = HEADING_RE.exec(line.raw);
    if (!match) continue;
    if (!match[1].toLowerCase().includes(EXECUTION_STATUS_HEADING.toLowerCase())) continue;
    if (isHeading(line)) {
      headingIndex = line.index;
      break;
    }
    if (shadowedIndex === -1) shadowedIndex = line.index;
  }
  if (headingIndex === -1) {
    // Saying "no heading found" about a file the operator can see the heading in sends them
    // hunting for the wrong thing. Name the copy we skipped and why.
    throw new ExecutionTableError(
      shadowedIndex === -1
        ? `No "${EXECUTION_STATUS_HEADING}" heading found in ${file}. ` +
          `An execution playbook requires a heading containing "${EXECUTION_STATUS_HEADING}" ` +
          `above its milestone table.`
        : `The only "${EXECUTION_STATUS_HEADING}" heading in ${file} is inside a code fence or ` +
          `a blockquote (line ${shadowedIndex + 1}), so it is an example, not the table. The ` +
          `loop reads the playbook itself — give the real table a heading of its own.`,
      file,
      shadowedIndex === -1 ? undefined : shadowedIndex + 1,
    );
  }

  let sectionEnd = lines.length;
  for (const line of scanned.slice(headingIndex + 1)) {
    if (isHeading(line)) {
      sectionEnd = line.index;
      break;
    }
  }

  const blocks = collectTableBlocks(lines, scanned, headingIndex + 1, sectionEnd);
  if (blocks.length === 0) {
    throw new ExecutionTableError(
      `No table found under the "${EXECUTION_STATUS_HEADING}" heading in ${file} ` +
        `(heading at line ${headingIndex + 1}).`,
      file,
      headingIndex + 1,
    );
  }

  const block = blocks.find(
    (b) => b.columns.milestone !== undefined && b.columns.status !== undefined,
  );
  if (!block) {
    throw new ExecutionTableError(
      `No table under the "${EXECUTION_STATUS_HEADING}" heading in ${file} ` +
        `(heading at line ${headingIndex + 1}) has both a Milestone column and a Status ` +
        `column. Candidate tables: ${describeCandidates(blocks)}.`,
      file,
      headingIndex + 1,
    );
  }

  const columns = block.columns as ColumnMap;
  if (block.dataLineIndices.length === 0) {
    throw new ExecutionTableError(
      `The ${EXECUTION_STATUS_HEADING} table in ${file} ` +
        `(header at line ${block.headerLineIndex + 1}) has no milestone rows.`,
      file,
      block.headerLineIndex + 1,
    );
  }

  const rows: MilestoneRow[] = block.dataLineIndices.map((lineIndex) => {
    const cells = splitRow(lines[lineIndex]);
    const { status, legacyBlocked } = parseStatus(
      cells[columns.status] ?? "",
      file,
      lineIndex,
    );
    return {
      id: cleanCell(cells[columns.milestone] ?? ""),
      name: optionalCell(cells, columns.name) ?? "",
      owner: parseOwner(cells, columns, file, lineIndex),
      status,
      commit: optionalCell(cells, columns.commit),
      notes: optionalCell(cells, columns.notes),
      lineIndex,
      legacyBlocked,
    };
  });

  return { rows, headerLineIndex: block.headerLineIndex, columns };
}

function sameId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Rewrites ONLY the status cell on that row's line, byte-preserving the rest — the operator's
 * own column alignment and Notes prose live on that same line. The cell's padding and its
 * backtick or bold wrapper are preserved.
 *
 * An absent row is a no-op, not an error: the operator may have deleted or renumbered the row
 * while paused, and a hand edit must never break resume.
 */
export function setMilestoneStatus(
  content: string,
  id: string,
  status: MilestoneStatus,
): string {
  const table = parseExecutionStatus(content);
  const row = table.rows.find((r) => sameId(r.id, id));
  if (!row) return content;

  const lines = content.split("\n");
  const line = lines[row.lineIndex];
  const span = splitRowSpans(line)[table.columns.status];
  if (!span) return content;

  const raw = line.slice(span.start, span.end);
  const leading = raw.slice(0, raw.length - raw.trimStart().length);
  const trailing = raw.slice(raw.trimEnd().length);
  const core = raw.trim();

  let replacement: string = status;
  if (core.startsWith("`") && core.endsWith("`")) replacement = `\`${status}\``;
  else if (core.startsWith("**") && core.endsWith("**")) replacement = `**${status}**`;

  lines[row.lineIndex] =
    line.slice(0, span.start) + leading + replacement + trailing + line.slice(span.end);
  return lines.join("\n");
}

/** The first row that is not `done` — the row the loop runs next. */
export function firstUnfinished(table: ExecutionTable): MilestoneRow | null {
  return table.rows.find((row) => row.status !== "done") ?? null;
}

export function rowStatus(table: ExecutionTable, id: string): MilestoneStatus | null {
  return table.rows.find((row) => sameId(row.id, id))?.status ?? null;
}

export function operatorGates(table: ExecutionTable): MilestoneRow[] {
  return table.rows.filter((row) => row.owner === "operator");
}

/**
 * Operator rows positioned after the LAST agent row — steps with no milestone left to unblock.
 * They are post-execution work and must not be in this table at all. Status is the caller's
 * filter; position is the question this answers.
 */
export function trailingOperatorRows(table: ExecutionTable): MilestoneRow[] {
  let lastAgent = -1;
  table.rows.forEach((row, index) => {
    if (row.owner === "agent") lastAgent = index;
  });
  return table.rows.filter((row, index) => index > lastAgent && row.owner === "operator");
}

/**
 * Unfinished agent work — the same "unfinished" predicate as `firstUnfinished`, never
 * `status === "pending"`. Read narrowly this under-sizes the loop's session cap on a resumed
 * playbook and pauses a healthy run.
 */
export function pendingAgentRows(table: ExecutionTable): MilestoneRow[] {
  return table.rows.filter((row) => row.status !== "done" && row.owner === "agent");
}

export function doneCount(table: ExecutionTable): number {
  return table.rows.filter((row) => row.status === "done").length;
}

export function hasOwnerColumn(table: ExecutionTable): boolean {
  return table.columns.owner !== undefined;
}

const STATUS_LIST = MILESTONE_STATUSES.map((s) => `\`${s}\``).join(", ");
const OWNER_LIST = OWNERS.map((o) => `\`${o}\``).join(" | ");

/**
 * The human-readable block both `planReviewPrompt` and `executeMilestonePrompt` interpolate.
 * Built FROM the unions above, never a hand-written copy of them: adding a status changes the
 * prompts automatically. Today's bug is partly a drift bug — `blocked` existed in the plan
 * prompt and meant nothing to the handler.
 */
export const EXECUTION_TABLE_SPEC = `### The milestone status table

\`${EXECUTION_PLAYBOOK_FILE}\` carries exactly one table that drives execution: the first table
under a heading containing "${EXECUTION_STATUS_HEADING}" that has both a \`Milestone\` column and
a \`Status\` column. Nothing outside that table is ever read — prose, summary tables and notes
elsewhere in the file are inert.

| Column | Required | Meaning |
|---|---|---|
| \`Milestone\` | yes | The row's ID. Any label the plan uses — \`M1\`, \`M5a\`, \`G1\`. IDs are never validated |
| \`Name\` | no | What the row delivers |
| \`Owner\` | no | ${OWNER_LIST}. An absent column or an empty cell means \`agent\` |
| \`Status\` | yes | One of ${STATUS_LIST} |
| \`Commit\` | no | Filled in by the pipeline |
| \`Notes\` | no | Free prose |

Rules:

- A row is a gate because its \`Owner\` is \`operator\`, never because of how its ID is spelled.
- Every gate row must be followed by the milestone it unblocks. A gate row with nothing after it
  is post-execution work and does not belong in this table at all.
- Merge, tag, release and deploy of this task's own branch are **not** rows: QA reviews the
  branch before it is merged, so those steps come after the pipeline is done.
- \`needs_operator\` marks a row the agent cannot finish on its own.

Worked example — fenced, and shown without its heading, because it is a picture of a table rather
than one. \`${EXECUTION_PLAYBOOK_FILE}\` carries exactly one \`${EXECUTION_STATUS_HEADING}\` heading
and one live table under it; anything fenced or quoted is inert to the loop. Put your rows under
your own heading — do not copy this contract into the playbook.

\`\`\`markdown
| Milestone | Name | Owner | Status | Commit | Notes |
|---|---|---|---|---|---|
| M1 | Table contract + parser | \`agent\` | \`done\` | \`a1b2c3d\` | — |
| G1 | Operator merges PRs #12 and #14 | \`operator\` | \`pending\` | — | Unblocks M2 |
| M2 | Wire the parser into the loop | \`agent\` | \`pending\` | — | — |
\`\`\`
`;
