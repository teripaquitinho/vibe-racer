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
  const state = readState(planPath);
  writeState(planPath, {
    ...state,
    stage: "error",
    error_stage: errorStage,
    error_message: message,
  });
}
