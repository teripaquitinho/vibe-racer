import { z } from "zod";

export const STAGES = [
  "need_objective",
  "ai_objective_review",
  "need_product",
  "ai_product_review",
  "need_design",
  "ai_design_review",
  "need_plan",
  "ai_plan_review",
  "need_execution",
  "ready_to_execute",
  "fine_tuning",
  "cleanup_ready",
  "done",
  "error",
] as const;

export type Stage = (typeof STAGES)[number];

export const stateSchema = z.object({
  stage: z.enum(STAGES),
  title: z.string(),
  created: z.string().optional(),
  updated: z.string().optional(),
  error_message: z.string().optional(),
  error_stage: z.string().optional(),
  trivial: z.boolean().optional(),
  prev: z.enum(STAGES).nullable().optional(),
  next: z.enum(STAGES).nullable().optional(),
});

export type TaskState = z.infer<typeof stateSchema>;
