import { STAGES, type Stage } from "../state/schema.js";

const AGENT_STAGES = new Set<Stage>([
  "ai_objective_review",
  "ai_product_review",
  "ai_design_review",
  "ai_plan_review",
  "ready_to_execute",
  "cleanup_ready",
]);

const STAGE_ORDER: Stage[] = STAGES.filter((s): s is Exclude<Stage, "error"> => s !== "error");

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

export const STAGE_QUESTIONS_FILE: Partial<Record<Stage, string>> = {
  need_objective: "00_objective.md",
  need_product: "01_product_questions.md",
  need_design: "02_design_questions.md",
  need_plan: "03_plan_questions.md",
  need_execution: "04_execute.md",
  fine_tuning: "04_execute.md",
};

export const STAGE_NEXT_NAME: Partial<Record<Stage, string>> = {
  need_objective: "Objective Review",
  need_product: "Product Review",
  need_design: "Design Review",
  need_plan: "Plan Review",
  need_execution: "Execution",
  fine_tuning: "Cleanup",
};
