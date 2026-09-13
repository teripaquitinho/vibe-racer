import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { parse, stringify } from "yaml";
import { STAGES, stateSchema, type Stage, type TaskState } from "./schema.js";
import { nextStage, previousStage } from "../pipeline/states.js";

const STATE_FILE = "state.yml";

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
    prev = (STAGES as readonly string[]).includes(state.error_stage ?? "")
      ? (state.error_stage as Stage)
      : null;
    next = null;
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
