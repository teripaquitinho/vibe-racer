import { describe, it, expect } from "vitest";
import {
  isAgentStage,
  isHumanStage,
  nextStage,
  previousStage,
  STAGE_NEXT_NAME,
  STAGE_QUESTIONS_FILE,
} from "../../src/pipeline/states.js";
import { OPERATOR_RESUME_MARKER } from "../../src/pipeline/operator-block.js";
import { STAGES, type Stage } from "../../src/state/schema.js";

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
    expect(nextStage("cleanup_ready")).toBe("need_decision");
  });

  it("returns null for the last stage", () => {
    expect(nextStage("done")).toBeNull();
  });
});

describe("previousStage", () => {
  it("returns the previous stage", () => {
    expect(previousStage("ai_objective_review")).toBe("need_objective");
    expect(previousStage("done")).toBe("need_decision");
  });

  it("returns null for the first stage", () => {
    expect(previousStage("need_objective")).toBeNull();
  });
});

describe("stage order regression", () => {
  it("nextStage(need_plan) === ai_plan_review", () => {
    expect(nextStage("need_plan")).toBe("ai_plan_review");
  });

  it("nextStage(ready_to_execute) === ai_qa", () => {
    expect(nextStage("ready_to_execute")).toBe("ai_qa");
  });

  it("nextStage(ai_qa) === fine_tuning", () => {
    expect(nextStage("ai_qa")).toBe("fine_tuning");
  });

  it("nextStage(cleanup_ready) === need_decision", () => {
    expect(nextStage("cleanup_ready")).toBe("need_decision");
  });

  it("nextStage(need_decision) === done", () => {
    expect(nextStage("need_decision")).toBe("done");
  });

  it("isAgentStage(ai_qa) === true", () => {
    expect(isAgentStage("ai_qa")).toBe(true);
  });

  it("isHumanStage(need_decision) === true", () => {
    expect(isHumanStage("need_decision")).toBe(true);
  });
});

describe("STAGE_QUESTIONS_FILE", () => {
  it("maps human stages to their questions files", () => {
    expect(STAGE_QUESTIONS_FILE.need_objective?.file).toBe("00_objective.md");
    expect(STAGE_QUESTIONS_FILE.need_product?.file).toBe("01_product_questions.md");
    expect(STAGE_QUESTIONS_FILE.need_design?.file).toBe("02_design_questions.md");
    expect(STAGE_QUESTIONS_FILE.need_plan?.file).toBe("03_plan_questions.md");
    expect(STAGE_QUESTIONS_FILE.need_execution?.file).toBe("04_execute.md");
    expect(STAGE_QUESTIONS_FILE.fine_tuning?.file).toBe("05_qa.md");
    expect(STAGE_QUESTIONS_FILE.need_decision?.file).toBe("06_decision.md");
  });

  it("carries the exact marker text for every mapped stage", () => {
    expect(STAGE_QUESTIONS_FILE.need_objective?.markerText).toBe(
      "Ready to advance to Objective Review",
    );
    expect(STAGE_QUESTIONS_FILE.need_execution?.markerText).toBe("Ready to advance to Execution");
    expect(STAGE_QUESTIONS_FILE.need_decision?.markerText).toBe("Ready to advance to Done");
  });

  it("maps need_operator to the playbook and the resume marker", () => {
    expect(STAGE_QUESTIONS_FILE.need_operator?.file).toBe("04_execute.md");
    expect(STAGE_QUESTIONS_FILE.need_operator?.markerText).toBe(OPERATOR_RESUME_MARKER);
  });

  // AC20. The PAIR is what must be unique, not the file: need_operator and need_execution
  // legitimately share 04_execute.md. Point need_operator at a "Ready to advance …" marker and
  // the sign-off tick resumes a pause nobody looked at — issue #3 in its new form.
  it("has a unique (file, markerText) pair for every stage", () => {
    const pairs = Object.values(STAGE_QUESTIONS_FILE).map((q) => `${q.file}::${q.markerText}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("never gives need_operator a Ready-to-advance marker", () => {
    expect(STAGE_QUESTIONS_FILE.need_operator?.markerText).not.toMatch(/Ready to advance/i);
  });
});

describe("need_operator", () => {
  it("is a stage", () => {
    expect((STAGES as readonly string[]).includes("need_operator")).toBe(true);
  });

  it("is outside the linear stage order", () => {
    expect(nextStage("need_operator")).toBeNull();
    expect(previousStage("need_operator")).toBeNull();
  });

  it("is a human stage, not an agent stage", () => {
    expect(isHumanStage("need_operator")).toBe(true);
    expect(isAgentStage("need_operator")).toBe(false);
  });

  // Every consumer of this map builds "Ready to advance to ${name}" — the one wording a pause
  // must never use.
  it("has no STAGE_NEXT_NAME entry", () => {
    expect(STAGE_NEXT_NAME.need_operator).toBeUndefined();
  });

  it("does not disturb the stages either side of it", () => {
    expect(nextStage("ready_to_execute")).toBe("ai_qa");
    expect(previousStage("ai_qa")).toBe("ready_to_execute");
  });
});

describe("stage order excludes only the detour stages", () => {
  it("every other stage has a next stage except done", () => {
    const detours: Stage[] = ["error", "need_operator"];
    for (const stage of STAGES) {
      if (detours.includes(stage) || stage === "done") {
        expect(nextStage(stage)).toBeNull();
      } else {
        expect(nextStage(stage)).not.toBeNull();
      }
    }
  });
});
