/**
 * The execution lap: run one session per milestone until the playbook says there is nothing
 * left, or until the loop can prove it is not getting anywhere and hands the task back.
 *
 * Split in two on purpose. `decideNextStep` and `foldOutcome` are pure — every acceptance
 * criterion about when the loop stops is a table-driven test over them with no mocks — and
 * `handleExecute` is the thin effectful driver that feeds them.
 *
 * Termination is structural, not behavioural: the loop stops even if the agent ignores every
 * instruction in its prompt and even if the table is misread. Three independent bounds do it —
 * the stall threshold, the per-`drive` session cap, and a table that can only ever shrink.
 */

import path from "path";
import { readFile, writeFile } from "fs/promises";
import type { TaskContext } from "../types.js";
import { runAndStream } from "../../claude/session.js";
import { executeMilestonePrompt } from "../../claude/prompts.js";
import {
  commitAll,
  createGit,
  repoSnapshot,
  type RepoSnapshot,
} from "../../git/operations.js";
import {
  clearResumedAt,
  pauseForOperator,
  readState,
  updateStage,
} from "../../state/store.js";
import {
  EXECUTION_PLAYBOOK_FILE,
  doneCount,
  firstUnfinished,
  hasOwnerColumn,
  parseExecutionStatus,
  pendingAgentRows,
  rowStatus,
  setMilestoneStatus,
  trailingOperatorRows,
  type ExecutionTable,
  type MilestoneRow,
  type MilestoneStatus,
} from "../execute-table.js";
import {
  OPERATOR_RESUME_MARKER,
  extractGateSection,
  findLastPauseBlock,
  nextPauseNumber,
  normalisePauseBlock,
  readPauseBlockState,
  renderPauseBlock,
  type PauseBlockInput,
  type PauseCause,
  type StallKind,
} from "../operator-block.js";
import { log } from "../../utils/logger.js";

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];

const PLAN_FILE = "03_plan.md";

/** Sessions on one milestone without finishing it before the operator is asked. */
export const MAX_STALLED_SESSIONS = 2;

/** Keeps the per-`drive` cap non-zero on a table with no unfinished agent rows. */
export const SESSION_CAP_SLACK = 2;

// --- The pure core ----------------------------------------------------------------------------

export interface LoopState {
  table: ExecutionTable;
  currentId: string | null;
  stalls: number;
  sessionsThisDrive: number;
  sessionCap: number;
  /** `state.resumed_at`, read once at loop entry. */
  resumedAt: string | null;
  lastOutcome: SessionOutcome | null;
}

export interface SessionOutcome {
  rowId: string;
  /** `null` ⇒ the row vanished mid-session (renamed, split or deleted by the agent). */
  statusAfter: MilestoneStatus | null;
  doneCountBefore: number;
  doneCountAfter: number;
  /** Commits or dirty files OUTSIDE the plan dir. Wording only — never the stall decision. */
  repoChanged: boolean;
  finalMessage: string | null;
}

export type Step =
  | { kind: "run"; row: MilestoneRow }
  | { kind: "pause"; row: MilestoneRow; cause: PauseCause }
  | { kind: "complete" };

/** Row IDs are compared the way the table compares them: trimmed, case-insensitive. */
function sameId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isTrailingOperatorRow(table: ExecutionTable, row: MilestoneRow): boolean {
  return trailingOperatorRows(table).some((r) => sameId(r.id, row.id));
}

/**
 * `1` for the row we were just resumed at, `MAX_STALLED_SESSIONS` otherwise: the operator has
 * already seen this wall once and should not pay twice to see it again.
 */
export function thresholdFor(rowId: string, resumedAt: string | null): number {
  return resumedAt !== null && sameId(rowId, resumedAt) ? 1 : MAX_STALLED_SESSIONS;
}

/**
 * Computed ONCE, at loop entry. Per-iteration it would let a table that grows raise its own
 * ceiling. Sized from the worst healthy case — a session that commits without finishing counts
 * as a stall, so a legitimate run can take `MAX_STALLED_SESSIONS` sessions per milestone.
 */
export function sessionCap(table: ExecutionTable): number {
  return pendingAgentRows(table).length * MAX_STALLED_SESSIONS + SESSION_CAP_SLACK;
}

/**
 * The branch order IS the specification — do not reorder.
 *
 * The trailing-operator branch is second on purpose. An unfinished operator row with no agent
 * milestone after it is post-execution work (merge, tag, release, deploy) that a hand-written
 * or pre-gate playbook left in the table. It must not gate the lap: execution stops *before*
 * the merge by finishing and handing the task to QA, which is the order the merge needs anyway.
 * `complete`, not `pause`, because there is no agent work left and a pause would ask the
 * operator to unblock something the pipeline is not waiting for.
 */
export function decideNextStep(state: LoopState): Step {
  const next = firstUnfinished(state.table);
  if (!next) return { kind: "complete" };

  if (isTrailingOperatorRow(state.table, next)) return { kind: "complete" };

  if (next.status === "needs_operator") {
    return {
      kind: "pause",
      row: next,
      cause: next.legacyBlocked ? "legacy_blocked" : "agent_declared",
    };
  }

  // A planned gate costs zero sessions: the pipeline never attempts a step it was told is human.
  if (next.owner === "operator") return { kind: "pause", row: next, cause: "planned_gate" };

  if (state.sessionsThisDrive >= state.sessionCap) {
    return { kind: "pause", row: next, cause: "session_cap" };
  }

  if (
    state.currentId !== null &&
    sameId(state.currentId, next.id) &&
    state.stalls >= thresholdFor(next.id, state.resumedAt)
  ) {
    return { kind: "pause", row: next, cause: "stall" };
  }

  return { kind: "run", row: next };
}

/**
 * A stall is judged on the milestone's row and nothing else: a session that committed code but
 * left the row unfinished is still a stall.
 *
 * A row that vanished mid-session is judged by position instead of by ID — if the agent renamed
 * or split it there is no row left to read, so a grown `doneCount` counts as progress. That is
 * never an exception; a renumbered row must not break the loop.
 *
 * The asymmetry this leaves is intended, not a bug to rediscover later: when the row is still
 * there but untouched — the agent went and finished a *later* milestone instead — `statusAfter`
 * is `"pending"`, so the `doneCount` branch never runs and the session counts as a stall. Two of
 * those pause at the first unfinished row while the repository visibly moved. That is the
 * intended reading (the row we asked for did not move), and out-of-order execution is deferred
 * by product decision. The wording stays honest because `repoChanged` is true in that case, so
 * the block says "committed but did not finish" rather than "made no changes".
 */
export function foldOutcome(state: LoopState, outcome: SessionOutcome): LoopState {
  let stalls: number;
  if (outcome.statusAfter === "done" || outcome.statusAfter === "needs_operator") {
    // `needs_operator` is progress, not a stall: `decideNextStep` pauses on the next tick.
    stalls = 0;
  } else if (outcome.statusAfter === null) {
    stalls = outcome.doneCountAfter > outcome.doneCountBefore ? 0 : state.stalls + 1;
  } else {
    stalls = state.stalls + 1;
  }

  return {
    ...state,
    stalls,
    currentId: outcome.rowId,
    sessionsThisDrive: state.sessionsThisDrive + 1,
    lastOutcome: outcome,
  };
}

// --- Pause-block content ----------------------------------------------------------------------

const GATE_FALLBACK_WHY = "an operator gate the plan declared";

const LEGACY_BLOCKED_NOTE =
  "`blocked` is no longer a status the pipeline writes. Tick the boxes below to retry this " +
  "milestone, or edit the Execution Status table by hand.";

const LEGACY_PLAYBOOK_NOTE =
  "This playbook predates operator gates; add a gate row to the Execution Status table if this " +
  "step is yours.";

/** The `**Why paused:**` line of a block the agent wrote, so `state.yml` quotes the agent. */
const WHY_LINE = /^\*\*Why paused:\*\*\s*(.+)$/m;

function blockText(content: string, startLine: number, endLine: number): string {
  return content.split("\n").slice(startLine, endLine + 1).join("\n");
}

function agentWhy(content: string, rowId: string): string | null {
  const location = findLastPauseBlock(content);
  if (!location || !sameId(location.rowId, rowId)) return null;
  const match = WHY_LINE.exec(blockText(content, location.startLine, location.endLine));
  return match ? match[1].trim() : null;
}

interface PauseParts {
  why: string;
  items: string[];
  verification: string | null;
  stallKind?: StallKind;
  extraNotes: string[];
}

/**
 * Content by cause. `items` may be empty — the renderer supplies the generic item itself, which
 * is what makes the guaranteed minimum impossible to omit whichever cause is being rendered.
 * We do not try to turn the agent's prose into a multi-item checklist: a wrong checklist is
 * worse than an honest generic one.
 */
function pausePartsFor(
  cause: PauseCause,
  row: MilestoneRow,
  loop: LoopState,
  planMarkdown: string | null,
  content: string,
): PauseParts {
  switch (cause) {
    case "planned_gate": {
      const gate = planMarkdown === null ? null : extractGateSection(planMarkdown, row.id);
      return {
        why: `${row.id} — ${row.name || GATE_FALLBACK_WHY}`,
        items: gate?.items ?? [],
        verification: gate?.verification ?? null,
        extraNotes: [],
      };
    }
    case "agent_declared":
      return {
        why:
          agentWhy(content, row.id) ??
          `${row.id} — the agent stopped and asked for the operator`,
        items: [],
        verification: null,
        extraNotes: [],
      };
    case "legacy_blocked":
      return {
        why: `${row.id} — marked \`blocked\` by an earlier run`,
        items: [],
        verification: null,
        extraNotes: [LEGACY_BLOCKED_NOTE],
      };
    case "stall":
      return {
        why: `${row.id} — no progress in ${loop.stalls} session${loop.stalls === 1 ? "" : "s"}`,
        items: [],
        verification: null,
        stallKind: loop.lastOutcome?.repoChanged ? "committed_unfinished" : "no_changes",
        extraNotes: hasOwnerColumn(loop.table) ? [] : [LEGACY_PLAYBOOK_NOTE],
      };
    case "session_cap":
      return {
        why:
          `Stopped after ${loop.sessionsThisDrive} sessions in one run — this is a safety ` +
          "limit; review the Execution Status table before resuming.",
        items: [],
        verification: null,
        extraNotes: [],
      };
  }
}

// --- The driver -------------------------------------------------------------------------------

/**
 * `before.head !== after.head` catches the agent committing for itself; the dirty-file sets
 * catch work it left uncommitted. Paths under the plan dir are already excluded by
 * `repoSnapshot`, so the agent flipping its own status cell does not read as "made changes".
 *
 * This feeds the pause block's wording ONLY. The stall decision is the row's business.
 */
function repoChanged(before: RepoSnapshot, after: RepoSnapshot): boolean {
  if (before.head !== after.head) return true;
  if (before.dirtyFiles.length !== after.dirtyFiles.length) return true;
  return before.dirtyFiles.some((file, i) => file !== after.dirtyFiles[i]);
}

/** Post-execution rows the loop deliberately walked past — logged, never dropped silently. */
function announceTrailingRows(table: ExecutionTable): void {
  const rows = trailingOperatorRows(table).filter((row) => row.status !== "done");
  if (rows.length === 0) return;
  const listed = rows.map((row) => (row.name ? `${row.id} — ${row.name}` : row.id)).join(", ");
  log.info(
    `Execution complete — ${rows.length} operator step(s) remain in the table and are yours ` +
      `after QA: ${listed}`,
  );
}

interface PausePaths {
  playbookPath: string;
  planFilePath: string;
  absPlanPath: string;
  playbookLabel: string;
}

/**
 * The pause, in order: block, status cell, file, state, commit, pit board.
 *
 * The state write comes BEFORE the commit, unlike other stages where it is swept up by the next
 * lap. A pause can last days and the operator's work at a gate is usually git work — branching,
 * rebasing, merging. A paused task must leave a clean working tree, or the operator's first
 * `git checkout` trips over a dirty `state.yml`.
 */
async function pause(
  ctx: TaskContext,
  git: ReturnType<typeof createGit>,
  loop: LoopState,
  step: Extract<Step, { kind: "pause" }>,
  paths: PausePaths,
): Promise<void> {
  const row = step.row;
  const content = await readFile(paths.playbookPath, "utf-8");

  // The agent's own block is normalised in place — appending a second one for the same row
  // would leave the operator diffing two blocks to find the live one.
  const existing = findLastPauseBlock(content);
  const reuse =
    step.cause === "agent_declared" && existing !== null && sameId(existing.rowId, row.id);
  const pauseNumber =
    reuse && existing
      ? nextPauseNumber(content.split("\n").slice(0, existing.startLine).join("\n"))
      : nextPauseNumber(content);

  let planMarkdown: string | null = null;
  if (step.cause === "planned_gate") {
    try {
      planMarkdown = await readFile(paths.planFilePath, "utf-8");
    } catch {
      planMarkdown = null; // No plan file: the renderer falls back to the generic item.
    }
  }

  const parts = pausePartsFor(step.cause, row, loop, planMarkdown, content);
  const input: PauseBlockInput = {
    pauseNumber,
    rowId: row.id,
    cause: step.cause,
    why: parts.why,
    items: parts.items,
    verification: parts.verification,
    // A planned gate runs no session, so there is no message to quote.
    agentMessage:
      step.cause === "planned_gate" ? null : (loop.lastOutcome?.finalMessage ?? null),
    branchName: ctx.branchName,
    stallKind: parts.stallKind,
    isRepause: loop.resumedAt !== null && sameId(loop.resumedAt, row.id),
    extraNotes: parts.extraNotes,
  };

  let next = reuse ? content : content + renderPauseBlock(input);
  next = normalisePauseBlock(next, {
    pauseNumber,
    rowId: row.id,
    branchName: ctx.branchName,
  });
  next = setMilestoneStatus(next, row.id, "needs_operator");
  await writeFile(paths.playbookPath, next, "utf-8");

  pauseForOperator(paths.absPlanPath, { milestone: row.id, reason: input.why });

  const hash = await commitAll(
    git,
    `vibe-racer: paused for operator at ${row.id} for #${ctx.taskNumber}`,
    ctx.cwd,
  );
  if (hash) log.dim(`Pause committed: ${hash}`);

  // The pit board. A pause is the pipeline working as designed, so neither "error" nor "failed"
  // appears here, and it is never styled red.
  log.warn(`Paused at ${row.id} — ${input.why}`);
  const checklist = readPauseBlockState(next)?.unchecked ?? [];
  if (checklist.length > 0) {
    log.info("Operator actions:");
    for (const item of checklist) log.info(`  - [ ] ${item.text}`);
  }
  log.info(
    `Tick "${OPERATOR_RESUME_MARKER}" in ${paths.playbookLabel}, then run 'vibe-racer drive'.`,
  );
}

export async function handleExecute(ctx: TaskContext): Promise<void> {
  const git = createGit(ctx.cwd);
  // One path convention in one file: the store helpers take an absolute plan path.
  const absPlanPath = path.join(ctx.cwd, ctx.planPath);
  const paths: PausePaths = {
    playbookPath: path.join(absPlanPath, EXECUTION_PLAYBOOK_FILE),
    planFilePath: path.join(absPlanPath, PLAN_FILE),
    absPlanPath,
    playbookLabel: `${ctx.planPath}/${EXECUTION_PLAYBOOK_FILE}`,
  };

  const readTable = async (): Promise<ExecutionTable> =>
    parseExecutionStatus(await readFile(paths.playbookPath, "utf-8"), paths.playbookLabel);

  const state = readState(absPlanPath);
  // A table that cannot be parsed throws all the way out to `withErrorHandling`, which records
  // the message and the file. It must never be read as "nothing left to do".
  const table = await readTable();

  let loop: LoopState = {
    table,
    currentId: null,
    stalls: 0,
    sessionsThisDrive: 0,
    sessionCap: sessionCap(table),
    resumedAt: state.resumed_at ?? null,
    lastOutcome: null,
  };

  for (;;) {
    const step = decideNextStep(loop);

    if (step.kind === "complete") {
      announceTrailingRows(loop.table);
      updateStage(absPlanPath, "ai_qa");
      log.success("All milestones complete — stage advanced to [ai_qa]");

      const closeHash = await commitAll(
        git,
        `vibe-racer: execution complete for #${ctx.taskNumber}`,
        ctx.cwd,
      );
      if (closeHash) {
        log.success(`Committed: ${closeHash}`);
      } else {
        log.dim("No changes to commit after execution");
      }
      log.info(
        `Task #${ctx.taskNumber} is ready for QA — run 'vibe-racer drive' to start the QA lap.`,
      );
      return;
    }

    if (step.kind === "pause") {
      await pause(ctx, git, loop, step, paths);
      return;
    }

    const row = step.row;
    const threshold = thresholdFor(row.id, loop.resumedAt);
    const remaining = pendingAgentRows(loop.table).length;
    // The ID comes from the table, never from a counter that was really counting sessions.
    log.info(
      `Executing ${row.id} (attempt ${loop.stalls + 1}/${threshold}, ${remaining} remaining)`,
    );

    const doneCountBefore = doneCount(loop.table);
    const before = await repoSnapshot(git, ctx.planPath);

    const { prompt, persona } = executeMilestonePrompt(ctx);
    const finalMessage = await runAndStream({
      prompt,
      persona,
      cwd: ctx.cwd,
      allowedTools: ALLOWED_TOOLS,
      stage: "ready_to_execute",
      taskPlanPath: ctx.planPath,
    });

    const hash = await commitAll(git, `vibe-racer: ${row.id} for #${ctx.taskNumber}`, ctx.cwd);
    const after = await repoSnapshot(git, ctx.planPath);
    const nextTable = await readTable();
    const statusAfter = rowStatus(nextTable, row.id);

    // An empty hash is never reported as success — it means one of two different things.
    if (hash) {
      log.success(`${row.id} committed: ${hash}`);
    } else if (before.head !== after.head) {
      log.dim(`${row.id} — no pipeline commit (agent committed its own)`);
    } else {
      log.dim(`${row.id} — nothing to commit`);
    }

    loop = foldOutcome(
      { ...loop, table: nextTable },
      {
        rowId: row.id,
        statusAfter,
        doneCountBefore,
        doneCountAfter: doneCount(nextTable),
        repoChanged: repoChanged(before, after),
        finalMessage: finalMessage ?? null,
      },
    );

    // Spend the resume the moment the resumed row finishes, or a later `drive` meeting a row
    // with that same ID would silently apply threshold 1 and charge a pause nobody earned.
    if (loop.resumedAt !== null && sameId(loop.resumedAt, row.id) && statusAfter === "done") {
      clearResumedAt(absPlanPath);
    }
  }
}
