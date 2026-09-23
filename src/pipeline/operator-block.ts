/**
 * The operator pause block — render it, find it, read it, normalise it.
 *
 * Nothing else in the codebase knows the block's shape. Pure by design: no `fs`, no `git`, no
 * logging and no imports from the state layer, so the handler owns file I/O and `prompts.ts`
 * can interpolate `PAUSE_BLOCK_SPEC` without creating a cycle.
 *
 * Two independent layers make agent prose structurally inert (design §4.4), because a session
 * that emits `- [x] Operator actions complete — resume execution` in its final message must not
 * be able to resume its own task:
 *
 *   1. the agent's message is rendered inside a `~` fence AND prefixed `> ` line by line;
 *   2. the scanner is fence-aware and accepts a checkbox only at column 0, outside a fence and
 *      outside a blockquote.
 *
 * Line-number convention, the same one `execute-table.ts` uses: structural indices are 0-based
 * (`PauseBlockLocation.startLine` / `endLine` index `content.split("\n")`, `endLine` inclusive)
 * while human-facing ones are 1-based (`PauseBlockState.unchecked[].line`, which `drive` prints
 * at a partial tick).
 */

export const OPERATOR_RESUME_MARKER = "Operator actions complete — resume execution";

/** Captures the pause number and the row ID. Only ever applied to a line the scanner cleared. */
export const PAUSE_HEADING_PATTERN = /^## Operator actions — pause (\d+) \(([^)]+)\)/;

const WHY_LABEL = "**Why paused:**";
const STALL_LABEL = "**What kind of stall:**";
const VERIFY_LABEL = "**Agent will verify on resume:**";
const AGENT_MESSAGE_LABEL = "**What the agent said:**";
const CLOSING_PREFIX = "When done, switch back to branch";

const NO_VERIFICATION = "None — the agent will simply retry";
const NO_MESSAGE = "The agent left no closing message; see the terminal log or the last commits";
const GENERIC_ITEM =
  "Resolve the issue described above (or edit the milestone in the Execution Status table)";

const STALL_WORDING: Record<StallKind, string> = {
  no_changes:
    "The agent made no changes to the repository — no new commits and a clean working tree. " +
    "That is usually an undeclared human-owned step; read the agent's message below.",
  committed_unfinished:
    "The agent committed work but did not finish this milestone. That is usually an oversized " +
    "milestone; review the commits, then resume or split the milestone.",
};

/** The three supported ways out of a pause (product §6.5), so AC16 holds with no scrollback. */
const WAYS_OUT =
  "Three ways out: do the work and tick every box; or overrule the agent — tick the boxes " +
  "without doing the work and it retries once; or edit the Execution Status table by hand " +
  "(mark the row `done`, reword it, renumber it or delete it), then tick and resume.";

export type PauseCause =
  | "planned_gate"
  | "agent_declared"
  | "stall"
  | "session_cap"
  | "legacy_blocked";

export type StallKind = "no_changes" | "committed_unfinished";

export interface PauseBlockInput {
  pauseNumber: number;
  rowId: string;
  cause: PauseCause;
  /** One sentence — also becomes `operator_reason` in `state.yml`. */
  why: string;
  /** Empty ⇒ the renderer supplies the generic item; a block never has zero items. */
  items: string[];
  /** `null` ⇒ "None — the agent will simply retry". */
  verification: string | null;
  /** `null` ⇒ the block says so plainly, never an empty quote (E5). */
  agentMessage: string | null;
  /** The task branch, named in the closing line (E17). */
  branchName: string;
  /** `stall` cause only. */
  stallKind?: StallKind;
  /** Renders the "<row> again" wording after an overrule (§6.2, AC10). */
  isRepause?: boolean;
  /** Legacy-playbook and legacy-`blocked` lines (§9.3). */
  extraNotes?: string[];
}

export interface PauseBlockLocation {
  number: number;
  rowId: string;
  /** 0-based index of the heading line. */
  startLine: number;
  /** 0-based index of the block's last line, inclusive. */
  endLine: number;
}

export interface PauseBlockState {
  markerTicked: boolean;
  /** Outstanding items, the resume marker excluded. `line` is 1-based. */
  unchecked: Array<{ line: number; text: string }>;
}

// --- Scanning -------------------------------------------------------------------------------

interface ScannedLine {
  /** Index into the array that was scanned, not necessarily into the whole file. */
  index: number;
  raw: string;
  /** Inside a fenced block, or the fence delimiter itself. */
  fenced: boolean;
  /** A blockquote line — where the agent's message lives. */
  quoted: boolean;
}

const FENCE_RE = /^(`{3,}|~{3,})/;

/**
 * Walks lines tracking fence state for both ``` and ~~~ runs, matching run length, so a fence
 * inside the agent's quoted message cannot close the fence that contains it.
 */
function scanLines(lines: string[]): ScannedLine[] {
  const out: ScannedLine[] = [];
  let fence: { char: string; length: number } | null = null;

  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    const match = FENCE_RE.exec(trimmed);
    let fenced = fence !== null;

    if (match) {
      const char = match[1][0];
      const length = match[1].length;
      if (fence === null) {
        fence = { char, length };
        fenced = true;
      } else if (char === fence.char && length >= fence.length && trimmed === match[1]) {
        fence = null;
        fenced = true;
      }
    }
    out.push({ index, raw, fenced, quoted: /^\s*>/.test(raw) });
  });
  return out;
}

interface Checkbox {
  ticked: boolean;
  text: string;
}

/**
 * A checkbox this module counts: column 0, outside every fence and blockquote.
 *
 * Deliberately NOT `validateDecisionChecklist` (`validation.ts`), which matches INDENTED
 * `- [ ]` on purpose — at `need_decision` an indented unworked item must still block. A pause
 * block has the opposite requirement: a `- [ ]` behind `> ` inside the agent's quoted message
 * is not an operator item (E6). Two functions with opposite indentation rules must not be
 * consolidated into one.
 */
function checkbox(line: ScannedLine): Checkbox | null {
  if (line.fenced || line.quoted) return null;
  const match = /^[-*]\s*\[([ xX])\]\s*(.*)$/.exec(line.raw);
  if (!match) return null;
  return { ticked: match[1] !== " ", text: match[2].trim() };
}

function isResumeMarker(box: Checkbox): boolean {
  return box.text.toLowerCase() === OPERATOR_RESUME_MARKER.toLowerCase();
}

function isHeading(line: ScannedLine): boolean {
  return !line.fenced && !line.quoted && /^#{1,6}\s/.test(line.raw);
}

function findPauseBlocks(content: string): PauseBlockLocation[] {
  const lines = content.split("\n");
  const scanned = scanLines(lines);
  const headings = scanned.filter(isHeading).map((line) => line.index);

  const blocks: PauseBlockLocation[] = [];
  for (const line of scanned) {
    if (line.fenced || line.quoted) continue;
    const match = PAUSE_HEADING_PATTERN.exec(line.raw);
    if (!match) continue;
    const next = headings.find((index) => index > line.index);
    blocks.push({
      number: Number(match[1]),
      rowId: match[2].trim(),
      startLine: line.index,
      endLine: next === undefined ? lines.length - 1 : next - 1,
    });
  }
  return blocks;
}

// --- Rendering ------------------------------------------------------------------------------

/**
 * The agent's message, quoted twice over: a `~` run longer than any run inside the message
 * (minimum 3) so it cannot break out of the fence, and a `> ` prefix on every line, which is
 * what actually makes it inert — a checkbox behind `> ` is never at a position `checkbox()`
 * accepts.
 */
function quoteAgentMessage(message: string): string[] {
  const longest = (message.match(/~{3,}/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "~".repeat(Math.max(3, longest + 1));
  const body = message
    .replace(/\r\n/g, "\n")
    .replace(/\s+$/, "")
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`));
  return [fence, ...body, fence];
}

function closingLine(branchName: string): string {
  return `${CLOSING_PREFIX} \`${branchName}\`, tick every box above and run \`vibe-racer drive\`.`;
}

function whyLine(input: PauseBlockInput): string {
  const why = input.why.trim();
  return input.isRepause
    ? `${WHY_LABEL} Pause ${input.pauseNumber} (${input.rowId} again) — ${why}`
    : `${WHY_LABEL} ${why}`;
}

/** The block's lines, without the blank-line padding `renderPauseBlock` adds around it. */
function renderBlockLines(input: PauseBlockInput): string[] {
  const items = input.items.map((item) => item.trim()).filter((item) => item.length > 0);
  const lines: string[] = [
    `## Operator actions — pause ${input.pauseNumber} (${input.rowId})`,
    "",
    whyLine(input),
    "",
  ];

  if (input.stallKind) {
    lines.push(`${STALL_LABEL} ${STALL_WORDING[input.stallKind]}`, "");
  }
  for (const note of input.extraNotes ?? []) {
    lines.push(note.trim(), "");
  }

  lines.push(AGENT_MESSAGE_LABEL, "");
  if (input.agentMessage && input.agentMessage.trim().length > 0) {
    lines.push(...quoteAgentMessage(input.agentMessage), "");
  } else {
    lines.push(NO_MESSAGE, "");
  }

  // The renderer fills every default itself — that is what makes the §5.2 guaranteed minimum
  // impossible to omit, whichever of the five causes is being rendered.
  lines.push(...(items.length > 0 ? items : [GENERIC_ITEM]).map((item) => `- [ ] ${item}`), "");
  lines.push(`${VERIFY_LABEL} ${input.verification?.trim() || NO_VERIFICATION}`, "");
  lines.push(`- [ ] ${OPERATOR_RESUME_MARKER}`, "");
  lines.push(closingLine(input.branchName), "");
  lines.push(WAYS_OUT);

  return lines;
}

/**
 * The single renderer for all five causes. Follows the `completionSection` idiom from
 * `validation.ts`: a pure function returning markdown a caller appends, padded with one
 * newline at each end.
 */
export function renderPauseBlock(input: PauseBlockInput): string {
  return `\n${renderBlockLines(input).join("\n")}\n`;
}

// --- Reading --------------------------------------------------------------------------------

export function findLastPauseBlock(content: string): PauseBlockLocation | null {
  const blocks = findPauseBlocks(content);
  return blocks.length > 0 ? blocks[blocks.length - 1] : null;
}

/**
 * The state of the LAST block only — which is what makes AC8 true by construction rather than
 * by a regex that happens to match the right thing. An earlier, fully-ticked block never
 * resumes a current pause, and neither does the ticked "Ready to advance to Execution" the
 * sign-off left in the same file.
 */
export function readPauseBlockState(content: string): PauseBlockState | null {
  const location = findLastPauseBlock(content);
  if (!location) return null;

  const lines = content.split("\n");
  const scanned = scanLines(lines.slice(location.startLine, location.endLine + 1));

  let markerTicked = false;
  const unchecked: Array<{ line: number; text: string }> = [];

  for (const line of scanned) {
    const box = checkbox(line);
    if (!box) continue;
    if (isResumeMarker(box)) {
      if (box.ticked) markerTicked = true;
      continue;
    }
    if (!box.ticked) {
      unchecked.push({ line: location.startLine + line.index + 1, text: box.text });
    }
  }
  return { markerTicked, unchecked };
}

/**
 * The `**Why paused:**` value of the LAST block, with the row it paused on. The handler quotes it
 * into `state.yml` when the agent authored the block itself; it lives here because this module is
 * the only one that is supposed to know how the block is spelled.
 */
export function readPauseBlockWhy(content: string): { rowId: string; why: string } | null {
  const location = findLastPauseBlock(content);
  if (!location) return null;

  const lines = content.split("\n");
  const scanned = scanLines(lines.slice(location.startLine, location.endLine + 1));
  const why = labelledValue(scanned, WHY_LABEL);
  return why === null ? null : { rowId: location.rowId, why };
}

/** Unticks the resume marker in the last block, leaving item checkboxes exactly as they were. */
export function untickResumeMarker(content: string): string {
  const location = findLastPauseBlock(content);
  if (!location) return content;

  const lines = content.split("\n");
  const block = lines.slice(location.startLine, location.endLine + 1);

  for (const line of scanLines(block)) {
    const box = checkbox(line);
    if (box && box.ticked && isResumeMarker(box)) {
      block[line.index] = line.raw.replace(/\[[xX]\]/, "[ ]");
    }
  }
  lines.splice(location.startLine, block.length, ...block);
  return lines.join("\n");
}

/** Last block's number + 1, or 1 on a block-free file. */
export function nextPauseNumber(content: string): number {
  const location = findLastPauseBlock(content);
  return location ? location.number + 1 : 1;
}

// --- Normalising ----------------------------------------------------------------------------

function labelledValue(scanned: ScannedLine[], label: string): string | null {
  const line = scanned.find(
    (candidate) => !candidate.fenced && !candidate.quoted && candidate.raw.startsWith(label),
  );
  if (!line) return null;
  const value = line.raw.slice(label.length).trim();
  return value.length > 0 ? value : null;
}

/** The agent's message as it was written, with the fence and the `> ` prefixes stripped back off. */
function liftAgentMessage(scanned: ScannedLine[]): string | null {
  const label = scanned.find(
    (line) => !line.fenced && !line.quoted && line.raw.startsWith(AGENT_MESSAGE_LABEL),
  );
  if (!label) return null;

  const quoted: string[] = [];
  for (const line of scanned.slice(label.index + 1)) {
    if (!line.fenced && !line.quoted) {
      if (line.raw.trim() === "") continue;
      break;
    }
    if (FENCE_RE.test(line.raw.trim()) && !line.quoted) continue;
    quoted.push(line.raw.replace(/^\s*>\s?/, ""));
  }
  const message = quoted.join("\n").trim();
  return message.length > 0 && message !== NO_MESSAGE ? message : null;
}

function liftWhy(scanned: ScannedLine[]): string {
  const labelled = labelledValue(scanned, WHY_LABEL);
  if (labelled) return labelled;

  const prose = scanned.slice(1).find((line) => {
    if (line.fenced || line.quoted || isHeading(line)) return false;
    if (line.raw.trim() === "" || checkbox(line)) return false;
    return !line.raw.startsWith("**");
  });
  return prose?.raw.trim() ?? "The agent paused this milestone without saying why.";
}

/**
 * Runs on EVERY pause, whoever wrote the block (design §4.5). Quoting covers the agent's
 * message; it does not cover a block the agent AUTHORED, which can arrive with every box and
 * the resume marker already ticked, a wrong pause number, or no marker at all.
 *
 * In order: untick every checkbox including the marker; correct the heading's number and row
 * ID; make the closing line name the task branch (E17); and if the §5.2 minimum is not met —
 * no marker, no actionable item, or no closing line — lift the agent's items and re-render
 * through `renderPauseBlock`. "Structurally impossible to omit" is only true once every block
 * has been through the renderer or this function.
 *
 * A content with no block at all is returned untouched: the handler appends a rendered block
 * before calling here, so there is nothing to normalise.
 */
export function normalisePauseBlock(
  content: string,
  ctx: { pauseNumber: number; rowId: string; branchName: string },
): string {
  const location = findLastPauseBlock(content);
  if (!location) return content;

  const lines = content.split("\n");
  const block = lines.slice(location.startLine, location.endLine + 1);

  for (const line of scanLines(block)) {
    const box = checkbox(line);
    if (box?.ticked) block[line.index] = line.raw.replace(/\[[xX]\]/, "[ ]");
  }

  block[0] = block[0].replace(
    PAUSE_HEADING_PATTERN,
    () => `## Operator actions — pause ${ctx.pauseNumber} (${ctx.rowId})`,
  );

  const scanned = scanLines(block);
  const boxes = scanned
    .map((line) => ({ line, box: checkbox(line) }))
    .filter((entry): entry is { line: ScannedLine; box: Checkbox } => entry.box !== null);

  const hasMarker = boxes.some((entry) => isResumeMarker(entry.box));
  const items = boxes.filter((entry) => !isResumeMarker(entry.box)).map((entry) => entry.box.text);
  const closing = scanned.find(
    (line) => !line.fenced && !line.quoted && line.raw.trimStart().startsWith(CLOSING_PREFIX),
  );

  let normalised: string[];
  if (hasMarker && items.length > 0 && closing) {
    block[closing.index] = closingLine(ctx.branchName);
    normalised = block;
  } else {
    // The §5.2 minimum is not met, so the agent's block is not salvageable as written: lift
    // what it does carry and put it through the renderer, which fills every default itself.
    normalised = renderBlockLines({
      pauseNumber: ctx.pauseNumber,
      rowId: ctx.rowId,
      cause: "agent_declared",
      why: liftWhy(scanned),
      items,
      verification: labelledValue(scanned, VERIFY_LABEL),
      agentMessage: liftAgentMessage(scanned),
      branchName: ctx.branchName,
    });
  }

  lines.splice(location.startLine, location.endLine - location.startLine + 1, ...normalised);
  return lines.join("\n");
}

// --- Gate sections in `03_plan.md` -----------------------------------------------------------

/**
 * The gate's own section in the plan — the checklist source for a `planned_gate` pause.
 *
 * Lives here, not in `execute-table.ts`, because its only consumer is pause-block construction
 * and its return type is a slice of `PauseBlockInput`. `null` when the plan has no such
 * section; the handler then falls back to the generic item (§5.3).
 */
export function extractGateSection(
  planMarkdown: string,
  gateId: string,
): { items: string[]; verification: string | null } | null {
  const lines = planMarkdown.split("\n");
  const scanned = scanLines(lines);

  let start = -1;
  let level = 0;
  for (const line of scanned) {
    if (!isHeading(line)) continue;
    const match = /^(#{1,6})\s+(.*)$/.exec(line.raw);
    if (!match) continue;
    const text = match[2].replace(/[*`]/g, "").trim();
    // `G1` must not match `G10`: the ID has to be followed by a boundary, not another
    // ID character.
    if (!text.toLowerCase().startsWith(gateId.toLowerCase())) continue;
    const rest = text.slice(gateId.length);
    if (rest.length > 0 && /^[\w-]/.test(rest)) continue;
    start = line.index;
    level = match[1].length;
    break;
  }
  if (start === -1) return null;

  // The section ends at the next heading of the same or higher level — or at the next gate's
  // heading whatever its level, since plans do not nest one gate inside another.
  let end = lines.length;
  for (const line of scanned.slice(start + 1)) {
    if (!isHeading(line)) continue;
    const match = /^(#{1,6})\s+(.*)$/.exec(line.raw);
    if (!match) continue;
    const isGate = /^G\d+([^\w-]|$)/.test(match[2].replace(/[*`]/g, "").trim());
    if (match[1].length <= level || isGate) {
      end = line.index;
      break;
    }
  }

  const items: string[] = [];
  let verification: string | null = null;
  for (const line of scanned.slice(start + 1, end)) {
    if (line.fenced) continue;
    const item = /^\s*[-*]\s*\[[ xX]\]\s*(.+)$/.exec(line.raw);
    if (item) {
      items.push(item[1].trim());
      continue;
    }
    if (verification === null) {
      const found = /^\s*\*\*Verification:\*\*\s*(.+)$/.exec(line.raw);
      if (found) verification = found[1].trim();
    }
  }
  return { items, verification };
}

// --- The prompt-facing contract ---------------------------------------------------------------

/**
 * The block format, quoted verbatim by `executeMilestonePrompt` so a block the agent writes
 * itself matches what `normalisePauseBlock` expects.
 *
 * The worked example is FENCED on purpose: a file that quotes this spec would otherwise grow a
 * phantom pause block that `findLastPauseBlock` would return ahead of the real one.
 */
export const PAUSE_BLOCK_SPEC = `### The operator pause block

When a milestone cannot be finished without the operator, append ONE block to the end of
\`04_execute.md\`. Every box starts unticked — the pipeline unticks them again anyway, and a
pre-ticked checklist is the one thing that could resume a task nobody has looked at.

Required parts, in this order:

1. the heading \`## Operator actions — pause <n> (<row id>)\`, where \`<n>\` is the previous
   block's number + 1 (or 1 if there is none) and \`<row id>\` is the Execution Status row;
2. \`${WHY_LABEL}\` and one sentence — which milestone stopped and why;
3. at least one actionable \`- [ ]\` item at column 0;
4. \`${VERIFY_LABEL}\` and the read-only check you will run when you come back, or
   "${NO_VERIFICATION}";
5. \`- [ ] ${OPERATOR_RESUME_MARKER}\` — this exact text, at column 0. It is deliberately NOT
   "Ready to advance …": that marker is already ticked in this file from sign-off;
6. the closing line: "${CLOSING_PREFIX} \`<task branch>\`, tick every box above and run
   \`vibe-racer drive\`."

Anything you quote — your own message, a log, a diff — goes in a fence with every line prefixed
\`> \`. Text behind \`> \` is inert: a checkbox there is never counted and can never resume a task.

\`\`\`markdown
## Operator actions — pause 1 (G1)

${WHY_LABEL} M9 builds on the layout API from PRs #12 and #14, which are not merged into
\`main\` (origin/main still at 273c1c9).

- [ ] Open PRs against \`main\` in order #12 → #14
- [ ] Merge both PRs

${VERIFY_LABEL} \`git merge-base --is-ancestor <each branch> origin/main\`

- [ ] ${OPERATOR_RESUME_MARKER}

${CLOSING_PREFIX} \`vibe-racer/0005_infinite-loop-fix\`, tick every box above and run \`vibe-racer drive\`.
\`\`\`
`;
