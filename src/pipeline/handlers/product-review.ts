import type { TaskContext } from "../types.js";
import { productReviewPrompt } from "../../claude/prompts.js";
import { handleReviewWithRounds } from "./review-runner.js";

export async function handleProductReview(ctx: TaskContext): Promise<void> {
  await handleReviewWithRounds({
    ctx,
    stage: "ai_product_review",
    promptFn: productReviewPrompt,
    specFile: "01_product.md",
    questionsFile: "01_product_questions.md",
    specDescription: "product specification",
    stageOnRevert: "need_product",
    stageOnSuccess: "need_design",
    commitMessage: `vibe-racer: product review for #${ctx.taskNumber}`,
  });
}
