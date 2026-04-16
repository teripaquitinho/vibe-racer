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
  ai_objective_review: withErrorHandling("objective-review", handleObjectiveReview),
  ai_product_review: withErrorHandling("product-review", handleProductReview),
  ai_design_review: withErrorHandling("design-review", handleDesignReview),
  ai_plan_review: withErrorHandling("plan-review", handlePlanReview),
  ready_to_execute: withErrorHandling("execute", handleExecute),
  cleanup_ready: withErrorHandling("done", handleDone),
};

export function dispatch(state: string, ctx: TaskContext): Promise<void> {
  const handler = HANDLERS[state];
  if (!handler) {
    throw new Error(`No handler for state: ${state}`);
  }
  return handler(ctx);
}
