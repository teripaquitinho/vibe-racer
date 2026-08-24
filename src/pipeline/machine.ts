import type { TaskContext } from "./types.js";
import { handleObjectiveReview } from "./handlers/objective-review.js";
import { handleProductReview } from "./handlers/product-review.js";
import { handleDesignReview } from "./handlers/design-review.js";
import { handlePlanReview } from "./handlers/plan-review.js";
import { handleExecute } from "./handlers/execute.js";
import { handleDone } from "./handlers/done.js";
import { withErrorHandling } from "./handlers/safe-wrapper.js";

type HandlerFn = (ctx: TaskContext) => Promise<void>;

const HANDLERS: Record<string, HandlerFn> = {
  ai_objective_review: withErrorHandling("ai_objective_review", handleObjectiveReview),
  ai_product_review: withErrorHandling("ai_product_review", handleProductReview),
  ai_design_review: withErrorHandling("ai_design_review", handleDesignReview),
  ai_plan_review: withErrorHandling("ai_plan_review", handlePlanReview),
  ready_to_execute: withErrorHandling("ready_to_execute", handleExecute),
  cleanup_ready: withErrorHandling("cleanup_ready", handleDone),
};

export function dispatch(state: string, ctx: TaskContext): Promise<void> {
  const handler = HANDLERS[state];
  if (!handler) {
    throw new Error(`No handler for state: ${state}`);
  }
  return handler(ctx);
}
