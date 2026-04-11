import type { TaskContext } from "../types.js";
import { designReviewPrompt } from "../../claude/prompts.js";
import { handleReviewWithRounds } from "./review-runner.js";

export async function handleDesignReview(ctx: TaskContext): Promise<void> {
  await handleReviewWithRounds({
    ctx,
    stage: "ai_design_review",
    promptFn: designReviewPrompt,
    specFile: "02_design.md",
    questionsFile: "02_design_questions.md",
    specDescription: "design specification",
    stageOnRevert: "need_design",
    stageOnSuccess: "need_plan",
    commitMessage: `vibe-racer: design review for #${ctx.taskNumber}`,
  });
}
