export interface LabelDefinition {
  name: string;
  color: string;
  description: string;
}

export const LABELS: readonly LabelDefinition[] = [
  { name: "1_need_objective", color: "e11d48", description: "Human: write objective" },
  { name: "2_ai_objective_review", color: "fb7185", description: "Agent: review objective" },
  { name: "3_need_product", color: "ea580c", description: "Human: answer product questions" },
  { name: "4_ai_product_review", color: "fb923c", description: "Agent: review product answers" },
  { name: "5_need_design", color: "d97706", description: "Human: answer design questions" },
  { name: "6_ai_design_review", color: "fbbf24", description: "Agent: review design answers" },
  { name: "7_need_plan", color: "16a34a", description: "Human: answer plan questions" },
  { name: "8_ai_plan_review", color: "4ade80", description: "Agent: review plan answers" },
  { name: "9_need_execution", color: "0d9488", description: "Human: review plan" },
  { name: "10_ready_to_execute", color: "2dd4bf", description: "Agent: execute milestone" },
  { name: "11_milestone_complete", color: "2563eb", description: "Human: review milestone" },
  { name: "12_fine_tuning", color: "60a5fa", description: "Human: manual tweaks" },
  { name: "13_cleanup_ready", color: "4f46e5", description: "Agent: final docs + cleanup" },
  { name: "14_done", color: "7c3aed", description: "Human: pipeline complete" },
  { name: "viberacer:error", color: "6b7280", description: "Error: agent failed mid-stage" },
] as const;

const AGENT_ACTIONABLE = new Set([
  "2_ai_objective_review",
  "4_ai_product_review",
  "6_ai_design_review",
  "8_ai_plan_review",
  "10_ready_to_execute",
  "13_cleanup_ready",
]);

export function isAgentActionable(label: string): boolean {
  return AGENT_ACTIONABLE.has(label);
}

export function isviberacerLabel(label: string): boolean {
  return LABELS.some((l) => l.name === label);
}

const LABEL_ORDER = LABELS.filter((l) => l.name !== "viberacer:error").map(
  (l) => l.name,
);

export function nextLabel(current: string): string | null {
  const idx = LABEL_ORDER.indexOf(current);
  if (idx === -1 || idx >= LABEL_ORDER.length - 1) return null;
  return LABEL_ORDER[idx + 1];
}

export function previousLabel(current: string): string | null {
  const idx = LABEL_ORDER.indexOf(current);
  if (idx <= 0) return null;
  return LABEL_ORDER[idx - 1];
}

// --- New stage-based API (coexists with labels during migration) ---

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
