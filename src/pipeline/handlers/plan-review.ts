import type { TaskContext } from "../types.js";
import { planReviewPrompt } from "../../claude/prompts.js";
import { handleReviewWithRounds } from "./review-runner.js";

export async function handlePlanReview(ctx: TaskContext): Promise<void> {
  await handleReviewWithRounds({
    ctx,
    stage: "ai_plan_review",
    promptFn: planReviewPrompt,
    specFile: "03_plan.md",
    questionsFile: "03_plan_questions.md",
    specDescription: "implementation plan",
    stageOnRevert: "need_plan",
    stageOnSuccess: "need_execution",
    commitMessage: `vibe-racer: plan review for #${ctx.taskNumber}`,
  });
}
