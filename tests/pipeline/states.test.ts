import { describe, it, expect } from "vitest";
import {
  isAgentActionable,
  isviberacerLabel,
  nextLabel,
  previousLabel,
  LABELS,
  isAgentStage,
  isHumanStage,
  nextStage,
  previousStage,
  STAGE_QUESTIONS_FILE,
} from "../../src/pipeline/states.js";

describe("isAgentActionable", () => {
  it("returns true for agent labels", () => {
    expect(isAgentActionable("2_ai_objective_review")).toBe(true);
    expect(isAgentActionable("4_ai_product_review")).toBe(true);
    expect(isAgentActionable("6_ai_design_review")).toBe(true);
    expect(isAgentActionable("8_ai_plan_review")).toBe(true);
    expect(isAgentActionable("10_ready_to_execute")).toBe(true);
    expect(isAgentActionable("13_cleanup_ready")).toBe(true);
  });

  it("returns false for human labels", () => {
    expect(isAgentActionable("1_need_objective")).toBe(false);
    expect(isAgentActionable("3_need_product")).toBe(false);
    expect(isAgentActionable("5_need_design")).toBe(false);
    expect(isAgentActionable("7_need_plan")).toBe(false);
    expect(isAgentActionable("9_need_execution")).toBe(false);
    expect(isAgentActionable("11_milestone_complete")).toBe(false);
    expect(isAgentActionable("12_fine_tuning")).toBe(false);
    expect(isAgentActionable("14_done")).toBe(false);
  });

  it("returns false for error label", () => {
    expect(isAgentActionable("viberacer:error")).toBe(false);
  });

  it("returns false for unknown labels", () => {
    expect(isAgentActionable("random_label")).toBe(false);
  });
});

describe("isviberacerLabel", () => {
  it("returns true for all defined labels", () => {
    for (const label of LABELS) {
      expect(isviberacerLabel(label.name)).toBe(true);
    }
  });

  it("returns false for unknown labels", () => {
    expect(isviberacerLabel("bug")).toBe(false);
    expect(isviberacerLabel("enhancement")).toBe(false);
  });
});

describe("nextLabel", () => {
  it("returns the next label in sequence", () => {
    expect(nextLabel("1_need_objective")).toBe("2_ai_objective_review");
    expect(nextLabel("2_ai_objective_review")).toBe("3_need_product");
    expect(nextLabel("12_fine_tuning")).toBe("13_cleanup_ready");
    expect(nextLabel("13_cleanup_ready")).toBe("14_done");
  });

  it("returns null for the last label", () => {
    expect(nextLabel("14_done")).toBeNull();
  });

  it("returns null for unknown labels", () => {
    expect(nextLabel("viberacer:error")).toBeNull();
    expect(nextLabel("unknown")).toBeNull();
  });
});

describe("previousLabel", () => {
  it("returns the previous label in sequence", () => {
    expect(previousLabel("2_ai_objective_review")).toBe("1_need_objective");
    expect(previousLabel("14_done")).toBe("13_cleanup_ready");
    expect(previousLabel("13_cleanup_ready")).toBe("12_fine_tuning");
  });

  it("returns null for the first label", () => {
    expect(previousLabel("1_need_objective")).toBeNull();
  });

  it("returns null for unknown labels", () => {
    expect(previousLabel("viberacer:error")).toBeNull();
  });
});

// --- Stage-based API tests ---

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
