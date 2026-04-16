import { describe, it, expect, vi } from "vitest";
import { dispatch } from "../../src/pipeline/machine.js";
import type { TaskContext } from "../../src/pipeline/types.js";

vi.mock("../../src/pipeline/handlers/objective-review.js", () => ({
  handleObjectiveReview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/pipeline/handlers/product-review.js", () => ({
  handleProductReview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/pipeline/handlers/design-review.js", () => ({
  handleDesignReview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/pipeline/handlers/plan-review.js", () => ({
  handlePlanReview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/pipeline/handlers/execute.js", () => ({
  handleExecute: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/pipeline/handlers/done.js", () => ({
  handleDone: vi.fn().mockResolvedValue(undefined),
}));

const CTX: TaskContext = {
  taskNumber: 1,
  title: "Test task",
  slug: "test-task",
  plansDir: "plans",
  planPath: "plans/0001_test-task",
  branchName: "vibe-racer/0001_test-task",
  cwd: "/tmp/repo",
  contextFiles: ["README.md"],
};

describe("dispatch", () => {
  it("routes ai_objective_review to objective-review handler", async () => {
    const mod = await import("../../src/pipeline/handlers/objective-review.js");
    await dispatch("ai_objective_review", CTX);
    expect(mod.handleObjectiveReview).toHaveBeenCalledWith(CTX);
  });

  it("routes ai_product_review to product-review handler", async () => {
    const mod = await import("../../src/pipeline/handlers/product-review.js");
    await dispatch("ai_product_review", CTX);
    expect(mod.handleProductReview).toHaveBeenCalledWith(CTX);
  });

  it("routes ai_design_review to design-review handler", async () => {
    const mod = await import("../../src/pipeline/handlers/design-review.js");
    await dispatch("ai_design_review", CTX);
    expect(mod.handleDesignReview).toHaveBeenCalledWith(CTX);
  });

  it("routes ai_plan_review to plan-review handler", async () => {
    const mod = await import("../../src/pipeline/handlers/plan-review.js");
    await dispatch("ai_plan_review", CTX);
    expect(mod.handlePlanReview).toHaveBeenCalledWith(CTX);
  });

  it("routes ready_to_execute to execute handler", async () => {
    const mod = await import("../../src/pipeline/handlers/execute.js");
    await dispatch("ready_to_execute", CTX);
    expect(mod.handleExecute).toHaveBeenCalledWith(CTX);
  });

  it("routes cleanup_ready to done handler", async () => {
    const mod = await import("../../src/pipeline/handlers/done.js");
    await dispatch("cleanup_ready", CTX);
    expect(mod.handleDone).toHaveBeenCalledWith(CTX);
  });

  it("throws for unknown state", () => {
    expect(() => dispatch("unknown_state", CTX)).toThrow(
      "No handler for state: unknown_state",
    );
  });

  it("throws for human-actionable states", () => {
    expect(() => dispatch("need_objective", CTX)).toThrow(
      "No handler for state: need_objective",
    );
  });
});

describe("dispatch — handler coverage", () => {
  it("does not throw for any agent-actionable state", async () => {
    await expect(dispatch("ai_objective_review", CTX)).resolves.toBeUndefined();
    await expect(dispatch("ai_product_review", CTX)).resolves.toBeUndefined();
    await expect(dispatch("ai_design_review", CTX)).resolves.toBeUndefined();
    await expect(dispatch("ai_plan_review", CTX)).resolves.toBeUndefined();
    await expect(dispatch("ready_to_execute", CTX)).resolves.toBeUndefined();
    await expect(dispatch("cleanup_ready", CTX)).resolves.toBeUndefined();
  });

  it("throws for human states", () => {
    expect(() => dispatch("need_objective", CTX)).toThrow(
      "No handler for state: need_objective",
    );
    expect(() => dispatch("need_product", CTX)).toThrow(
      "No handler for state: need_product",
    );
  });

  it("throws for unknown states", () => {
    expect(() => dispatch("random", CTX)).toThrow(
      "No handler for state: random",
    );
  });
});
