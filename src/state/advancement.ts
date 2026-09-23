import path from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import type { Stage } from "./schema.js";
import { clearResumedAt, resumeFromOperator, updateStage } from "./store.js";
import { STAGE_QUESTIONS_FILE, nextStage } from "../pipeline/states.js";
import {
  hasCompletionMarker,
  removeCompletionMarker,
  validateAnswers,
  validateDecisionChecklist,
} from "../pipeline/validation.js";
import {
  EXECUTION_PLAYBOOK_FILE,
  ExecutionTableError,
  operatorGates,
  parseExecutionStatus,
  rowStatus,
  setMilestoneStatus,
  trailingOperatorRows,
  type ExecutionTable,
} from "../pipeline/execute-table.js";
import {
  OPERATOR_RESUME_MARKER,
  findLastPauseBlock,
  readPauseBlockState,
  untickResumeMarker,
} from "../pipeline/operator-block.js";
import { log } from "../utils/logger.js";

interface AdvancementResult {
  advanced: boolean;
  reason:
    | "no_questions_file"
    | "no_marker"
    | "incomplete_answers"
    | "incomplete_checklist"
    | "advanced"
    | "resumed"
    | "no_next_stage"
    | "unparsable_table"
    | "trailing_operator_rows";
}

export async function tryAdvance(
  planPath: string,
  currentStage: Stage,
  cwd: string,
): Promise<AdvancementResult> {
  // The pause detour has its own marker, its own checklist and its own settle step. Bolting
  // those onto the generic path below would put `validateAnswers` — which looks for
  // `**Answer:**` markers a playbook does not have — in front of every resume.
  if (currentStage === "need_operator") {
    return resumeFromOperatorPause(planPath, cwd);
  }

  const questionsFile = STAGE_QUESTIONS_FILE[currentStage]?.file;
  if (!questionsFile) {
    return { advanced: false, reason: "no_questions_file" };
  }

  const filePath = path.join(cwd, planPath, questionsFile);
  if (!existsSync(filePath)) {
    return { advanced: false, reason: "no_questions_file" };
  }

  if (!hasCompletionMarker(filePath)) {
    return { advanced: false, reason: "no_marker" };
  }

  const validation = await validateAnswers(filePath);
  if (!validation.complete) {
    removeCompletionMarker(filePath);
    log.warn(
      `Incomplete answers in ${questionsFile}:\n${validation.unanswered.map((q) => `  - ${q}`).join("\n")}`,
    );
    return { advanced: false, reason: "incomplete_answers" };
  }

  if (currentStage === "need_decision") {
    const checklist = validateDecisionChecklist(filePath);
    if (!checklist.valid) {
      removeCompletionMarker(filePath);
      log.warn(`Decision checklist has ${checklist.unchecked.length} unworked item(s):`);
      for (const item of checklist.unchecked) {
        log.warn(`  line ${item.line}: ${item.text}`);
      }
      return { advanced: false, reason: "incomplete_checklist" };
    }
  }

  if (currentStage === "need_execution" && !signOffPlaybook(filePath)) {
    return { advanced: false, reason: "trailing_operator_rows" };
  }

  // The `null` case guards the write but NOT the return in the version this replaces — a
  // permanent false success for any stage outside STAGE_ORDER that owns a questions file, which
  // is precisely the shape `need_operator` has. Returning here closes the hazard class instead
  // of relying on the delegation above to route around it.
  const next = nextStage(currentStage);
  if (!next) {
    return { advanced: false, reason: "no_next_stage" };
  }
  updateStage(path.join(cwd, planPath), next);

  return { advanced: true, reason: "advanced" };
}

/**
 * The sign-off checks on `04_execute.md`, run once the operator has ticked it.
 *
 * Returns false only for a trailing operator row — the one blocking check at this stage. Every
 * other outcome, including a table that cannot be parsed at all, is a log line: the marker is
 * already ticked, and failing the tick would strand the task at a stage whose checkbox says go.
 */
function signOffPlaybook(filePath: string): boolean {
  let table: ExecutionTable;
  try {
    table = parseExecutionStatus(readFileSync(filePath, "utf-8"), EXECUTION_PLAYBOOK_FILE);
  } catch (e) {
    log.warn(
      `Could not read the Execution Status table in ${EXECUTION_PLAYBOOK_FILE}: ${describeTableError(e)}`,
    );
    return true;
  }

  // Status-blind on purpose, and NOT the filter `announceTrailingRows` uses in the loop
  // (`pipeline/handlers/execute.ts`). This runs BEFORE execution, where a `done` cell is the plan
  // author claiming something rather than the pipeline observing it — honouring it would make
  // "mark the row done" the way around a gate whose whole job is keeping post-execution work out
  // of the table. Deleting the row stays the only way through. After execution the same cell IS
  // an observation, which is why the loop filters on it.
  const trailing = trailingOperatorRows(table);
  if (trailing.length > 0) {
    removeCompletionMarker(filePath);
    const named = trailing.map((row) => `\`${row.id}${row.name ? ` — ${row.name}` : ""}\``).join(", ");
    log.warn(`${named} have no milestone after them.`);
    log.warn(
      "Merging this task's PR, tagging, releasing and deploying happen after the QA lap — " +
        "they are not execution milestones and do not belong in the Execution Status table.",
    );
    log.warn(
      "Delete these rows (keep them in the plan's closing notes if you want them written down), " +
        "then tick the box again.",
    );
    return false;
  }

  // AC14: the tick is the consent, so this announces and never asks again.
  const gates = operatorGates(table);
  if (gates.length > 0) {
    log.info(
      `This plan contains ${gates.length} operator gate${gates.length === 1 ? "" : "s"}: ` +
        `${gates.map((row) => row.id).join(", ")}`,
    );
  } else {
    log.info("This plan contains no operator gates — execution runs start to finish.");
  }
  return true;
}

function describeTableError(e: unknown): string {
  if (e instanceof ExecutionTableError) {
    return e.line === undefined ? e.message : `${e.message} (line ${e.line})`;
  }
  return String(e);
}

/**
 * Resume out of an operator pause: read the last pause block, settle the row it paused on, and
 * send the task back to the stage it came from.
 *
 * Nothing in here throws. `tryAdvance` runs inside `drive`'s un-wrapped `for (const task of
 * tasks)` loop, so an escaping `ExecutionTableError` would abort `drive` for every task before
 * any is selected — from the operator's seat indistinguishable from vibe-racer being broken.
 * Turning an unparseable table into `stage: error` stays the execute handler's job, where the
 * task is the one being dispatched and `withErrorHandling` is in the stack.
 */
export async function resumeFromOperatorPause(
  planPath: string,
  cwd: string,
): Promise<AdvancementResult> {
  const questions = STAGE_QUESTIONS_FILE.need_operator;
  if (!questions) return { advanced: false, reason: "no_questions_file" };

  const filePath = path.join(cwd, planPath, questions.file);
  if (!existsSync(filePath)) {
    return { advanced: false, reason: "no_questions_file" };
  }

  const content = readFileSync(filePath, "utf-8");

  // Only the LAST block is ever read. That is what makes a ticked marker in an earlier block —
  // or the ticked "Ready to advance to Execution" the sign-off left in this same file — inert,
  // by construction rather than by a regex that happens to match the right thing.
  const location = findLastPauseBlock(content);
  if (!location) {
    // The marker text is in the file but no block was found around it. The scanner is fence-aware
    // and the parser is not, so an unterminated fence ANYWHERE above the block hides it — and
    // without this line the operator ticks the box, `drive` says nothing at all, and the task is
    // listed again with the instruction they just followed.
    if (content.includes(OPERATOR_RESUME_MARKER)) {
      log.warn(
        `Found "${OPERATOR_RESUME_MARKER}" in ${questions.file}, but no pause block around it.`,
      );
      log.warn(
        "An unterminated code fence above the block hides it from the reader. Close the stray " +
          "``` fence, then run `vibe-racer drive` again.",
      );
    }
    return { advanced: false, reason: "no_marker" };
  }

  const state = readPauseBlockState(content);
  if (!state?.markerTicked) return { advanced: false, reason: "no_marker" };

  if (state.unchecked.length > 0) {
    // No session is started: the operator ticked the marker with work outstanding, so put the
    // marker back and say which items. Deliberately the same feel as need_decision today.
    writeFileSync(filePath, untickResumeMarker(content), "utf-8");
    log.warn(`Operator checklist has ${state.unchecked.length} outstanding item(s):`);
    for (const item of state.unchecked) {
      log.warn(`  line ${item.line}: ${item.text}`);
    }
    return { advanced: false, reason: "incomplete_checklist" };
  }

  let settledGate = false;
  try {
    const settled = settleRow(content, location.rowId);
    settledGate = settled.wasGate;
    if (settled.content !== content) writeFileSync(filePath, settled.content, "utf-8");
  } catch (e) {
    log.error(
      `Could not read the Execution Status table in ${questions.file}: ${describeTableError(e)}`,
    );
    log.error("Fix the table by hand, then run `vibe-racer drive` again.");
    return { advanced: false, reason: "unparsable_table" };
  }

  const absPlanPath = path.join(cwd, planPath);
  const { pausedStage } = resumeFromOperator(absPlanPath);
  // `resumed_at` buys the resumed row ONE session before the next pause (`thresholdFor`). A gate
  // row is settled here and never runs, so the budget would sit in `state.yml` unspent — and land
  // on whatever agent row an operator later renumbers to that ID. The loop spends its own.
  if (settledGate) clearResumedAt(absPlanPath);
  log.success(`Resuming ${location.rowId} at [${pausedStage}]`);
  return { advanced: true, reason: "resumed" };
}

/**
 * Settle the paused row, guarded by the status the operator left it in (AC9). A hand edit — to
 * `done`, to a new ID, or deleting the row outright — must survive resume untouched, so only the
 * two statuses the pipeline itself wrote are rewritten.
 */
function settleRow(content: string, rowId: string): { content: string; wasGate: boolean } {
  const table = parseExecutionStatus(content, EXECUTION_PLAYBOOK_FILE);
  const row = table.rows.find((candidate) => candidate.id.toLowerCase() === rowId.toLowerCase());
  if (!row) return { content, wasGate: false };

  const status = rowStatus(table, rowId);
  if (row.owner === "operator" && (status === "pending" || status === "needs_operator")) {
    return { content: setMilestoneStatus(content, rowId, "done"), wasGate: true };
  }
  if (row.owner === "agent" && status === "needs_operator") {
    return { content: setMilestoneStatus(content, rowId, "pending"), wasGate: false };
  }
  // A row the operator hand-edited — to `done`, to a new ID, or deleted outright. Untouched here,
  // and it keeps its resume budget: an agent row settled by hand still has a session to run.
  return { content, wasGate: false };
}
