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
  "need_operator",
  "ai_qa",
  "fine_tuning",
  "cleanup_ready",
  "need_decision",
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
  // Operator-pause fields. Deliberately not folded into error_stage/error_message: pitwall and
  // drive must tell a pause from a failure without string-inspecting a stage name, and a task
  // can legitimately error while it carries pause fields.
  paused_stage: z.enum(STAGES).optional(),   // where to return to — always ready_to_execute in v1
  operator_reason: z.string().optional(),    // the one-line reason shown to the operator
  operator_milestone: z.string().optional(), // the paused row's ID
  resumed_at: z.string().optional(),         // row ID just resumed — drives the retry threshold
});

export type TaskState = z.infer<typeof stateSchema>;
