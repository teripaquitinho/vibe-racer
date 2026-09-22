import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { parse, stringify } from "yaml";
import { STAGES, stateSchema, type Stage, type TaskState } from "./schema.js";
import { nextStage, previousStage } from "../pipeline/states.js";

const STATE_FILE = "state.yml";

/** The one membership test for a stage name arriving as a loose string. */
export function validStage(s: string | undefined): Stage | null {
  return (STAGES as readonly string[]).includes(s ?? "") ? (s as Stage) : null;
}

export function readState(planPath: string): TaskState {
  const filePath = path.join(planPath, STATE_FILE);
  const raw = parse(readFileSync(filePath, "utf-8"));
  return stateSchema.parse(raw);
}

export function writeState(planPath: string, state: TaskState): void {
  const filePath = path.join(planPath, STATE_FILE);

  let prev: Stage | null;
  let next: Stage | null;
  if (state.stage === "error") {
    prev = validStage(state.error_stage);
    next = null;
  } else if (state.stage === "need_operator") {
    // The detour returns whence it came, so pitwall still renders a forward arrow.
    const paused = validStage(state.paused_stage) ?? "ready_to_execute";
    prev = paused;
    next = paused;
  } else {
    prev = previousStage(state.stage);
    next = nextStage(state.stage);
  }

  const updated = { ...state, prev, next, updated: new Date().toISOString() };
  stateSchema.parse(updated);
  writeFileSync(filePath, stringify(updated), "utf-8");
}

export function updateStage(planPath: string, newStage: Stage): void {
  const state = readState(planPath);
  writeState(planPath, { ...state, stage: newStage });
}

// --- Operator pause ---------------------------------------------------------------------------
// `planPath` for all three helpers is ABSOLUTE. The codebase carries two conventions that
// disagree silently — handlers pass repo-relative `ctx.planPath` into `updateStage` and get away
// with it only because the process cwd is the repo root, while `advancement.ts` joins it onto
// `cwd` first. Getting it wrong here is neither quiet nor contained: `readState` throws ENOENT,
// and `tryAdvance` runs in `drive`'s un-wrapped loop, so one bad path takes down `drive` for
// every task before any is selected.

/** Park the task at `need_operator`, recording why and which row stopped. */
export function pauseForOperator(
  planPath: string,
  args: { milestone: string; reason: string; pausedStage?: Stage },
): void {
  const state = readState(planPath);
  writeState(planPath, {
    ...state,
    stage: "need_operator",
    paused_stage: args.pausedStage ?? "ready_to_execute",
    operator_reason: args.reason,
    operator_milestone: args.milestone,
    resumed_at: undefined,
  });
}

/**
 * Send the task back to the stage it paused from. Returns the row ID BEFORE clearing it — the
 * caller needs it, and a leftover `operator_reason` would otherwise haunt `pitwall` for the rest
 * of the task's life. Clearing lives here, in one place, so no caller has to remember the list.
 */
export function resumeFromOperator(
  planPath: string,
): { pausedStage: Stage; milestone?: string } {
  const state = readState(planPath);
  const pausedStage = validStage(state.paused_stage) ?? "ready_to_execute";
  const milestone = state.operator_milestone;
  writeState(planPath, {
    ...state,
    stage: pausedStage,
    paused_stage: undefined,
    operator_reason: undefined,
    operator_milestone: undefined,
    resumed_at: milestone,
  });
  return { pausedStage, milestone };
}

/** Spend the resume: one write, then never again. */
export function clearResumedAt(planPath: string): void {
  const state = readState(planPath);
  writeState(planPath, { ...state, resumed_at: undefined });
}

export function setError(
  planPath: string,
  errorStage: string,
  message: string,
): void {
  let salvaged: Partial<TaskState> = {};
  try {
    salvaged = readState(planPath);
  } catch {
    try {
      const raw = readFileSync(path.join(planPath, STATE_FILE), "utf-8");
      const parsed = parse(raw);
      if (typeof parsed?.title === "string") salvaged.title = parsed.title;
      if (typeof parsed?.created === "string") salvaged.created = parsed.created;
      if (typeof parsed?.trivial === "boolean") salvaged.trivial = parsed.trivial;
    } catch {
      // Give up salvaging
    }
  }
  try {
    writeState(planPath, {
      ...salvaged,
      stage: "error",
      title: salvaged.title ?? path.basename(planPath),
      error_stage: errorStage,
      error_message: message,
    } as TaskState);
  } catch {
    // Last resort: writeState now validates, so it can reject. setError is the
    // final line of defence and must never throw — hand-write a minimal valid record.
    writeFileSync(
      path.join(planPath, STATE_FILE),
      stringify({
        stage: "error",
        title: path.basename(planPath),
        error_stage: errorStage,
        error_message: message,
        prev: null,
        next: null,
        updated: new Date().toISOString(),
      }),
      "utf-8",
    );
  }
}
