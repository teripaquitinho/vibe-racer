import { describe, it, expect } from "vitest";
import {
  isAgentStage,
  isHumanStage,
  nextStage,
  previousStage,
  STAGE_QUESTIONS_FILE,
} from "../../src/pipeline/states.js";

describe("isAgentStage", () => {
  it("returns true for agent stages", () => {
    expect(isAgentStage("ai_objective_review")).toBe(true);
    expect(isAgentStage("ai_product_review")).toBe(true);
    expect(isAgentStage("ai_design_review")).toBe(true);
    expect(isAgentStage("ai_plan_review")).toBe(true);
    expect(isAgentStage("ready_to_execute")).toBe(true);
    expect(isAgentStage("cleanup_ready")).toBe(true);
  });

  it("returns false for human stages", () => {
    expect(isAgentStage("need_objective")).toBe(false);
    expect(isAgentStage("need_product")).toBe(false);
    expect(isAgentStage("done")).toBe(false);
    expect(isAgentStage("error")).toBe(false);
  });
});

describe("isHumanStage", () => {
  it("returns true for human stages", () => {
    expect(isHumanStage("need_objective")).toBe(true);
    expect(isHumanStage("need_product")).toBe(true);
    expect(isHumanStage("fine_tuning")).toBe(true);
  });

  it("returns false for agent stages, done, and error", () => {
    expect(isHumanStage("ai_objective_review")).toBe(false);
    expect(isHumanStage("done")).toBe(false);
    expect(isHumanStage("error")).toBe(false);
  });
});

describe("nextStage", () => {
  it("returns the next stage in sequence", () => {
    expect(nextStage("need_objective")).toBe("ai_objective_review");
    expect(nextStage("ai_objective_review")).toBe("need_product");
    expect(nextStage("cleanup_ready")).toBe("done");
  });

  it("returns null for the last stage", () => {
    expect(nextStage("done")).toBeNull();
  });
});

describe("previousStage", () => {
  it("returns the previous stage", () => {
    expect(previousStage("ai_objective_review")).toBe("need_objective");
    expect(previousStage("done")).toBe("cleanup_ready");
  });

  it("returns null for the first stage", () => {
    expect(previousStage("need_objective")).toBeNull();
  });
});

describe("STAGE_QUESTIONS_FILE", () => {
  it("maps human stages to their questions files", () => {
    expect(STAGE_QUESTIONS_FILE.need_objective).toBe("00_objective.md");
    expect(STAGE_QUESTIONS_FILE.need_product).toBe("01_product_questions.md");
    expect(STAGE_QUESTIONS_FILE.need_design).toBe("02_design_questions.md");
    expect(STAGE_QUESTIONS_FILE.need_plan).toBe("03_plan_questions.md");
    expect(STAGE_QUESTIONS_FILE.need_execution).toBe("04_execute.md");
    expect(STAGE_QUESTIONS_FILE.fine_tuning).toBe("04_execute.md");
  });
});
