import { STAGES, type Stage } from "../state/schema.js";
import { OPERATOR_RESUME_MARKER } from "./operator-block.js";

const AGENT_STAGES = new Set<Stage>([
  "ai_objective_review",
  "ai_product_review",
  "ai_design_review",
  "ai_plan_review",
  "ready_to_execute",
  "ai_qa",
  "cleanup_ready",
]);

/**
 * Detour stages: reachable, but not part of the forward sequence. Naming the set makes the next
 * detour a one-line change and keeps `nextStage`/`previousStage` honest — a stage in here has
 * neither.
 */
const NON_LINEAR_STAGES = new Set<Stage>(["error", "need_operator"]);

const STAGE_ORDER: Stage[] = STAGES.filter((s) => !NON_LINEAR_STAGES.has(s));

export function isAgentStage(stage: Stage): boolean {
  return AGENT_STAGES.has(stage);
}

export function isHumanStage(stage: Stage): boolean {
  return !AGENT_STAGES.has(stage) && stage !== "error" && stage !== "done";
}

export function nextStage(current: Stage): Stage | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx === -1 || idx >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export function previousStage(current: Stage): Stage | null {
  const idx = STAGE_ORDER.indexOf(current);
  if (idx <= 0) return null;
  return STAGE_ORDER[idx - 1];
}

/** The file the human ticks, and the exact checkbox text they tick in it. */
export interface StageQuestions {
  file: string;
  markerText: string;
}

/**
 * One map, not two parallel ones — two maps can disagree. The `(file, markerText)` PAIR must
 * stay unique: two stages sharing both means a stale tick advances the later one with no human
 * input (issue #3). `need_operator` shares `04_execute.md` with `need_execution` and is safe
 * only because its marker is deliberately not a "Ready to advance …" line.
 */
export const STAGE_QUESTIONS_FILE: Partial<Record<Stage, StageQuestions>> = {
  need_objective: { file: "00_objective.md", markerText: "Ready to advance to Objective Review" },
  need_product: { file: "01_product_questions.md", markerText: "Ready to advance to Product Review" },
  need_design: { file: "02_design_questions.md", markerText: "Ready to advance to Design Review" },
  need_plan: { file: "03_plan_questions.md", markerText: "Ready to advance to Plan Review" },
  need_execution: { file: "04_execute.md", markerText: "Ready to advance to Execution" },
  need_operator: { file: "04_execute.md", markerText: OPERATOR_RESUME_MARKER },
  fine_tuning: { file: "05_qa.md", markerText: "Ready to advance to Cleanup" },
  need_decision: { file: "06_decision.md", markerText: "Ready to advance to Done" },
};

/**
 * No `need_operator` entry, on purpose: every consumer builds `"Ready to advance to ${name}"`,
 * which is exactly the wording a pause must never use.
 */
export const STAGE_NEXT_NAME: Partial<Record<Stage, string>> = {
  need_objective: "Objective Review",
  need_product: "Product Review",
  need_design: "Design Review",
  need_plan: "Plan Review",
  need_execution: "Execution",
  fine_tuning: "Cleanup",
  need_decision: "Done",
};
