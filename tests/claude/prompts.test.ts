import { describe, it, expect } from "vitest";
import {
  PERSONAS,
  MAX_QUESTIONS_PER_ROUND,
  MAX_QUESTION_ROUNDS,
  followUpSectionHeading,
  forcedSpecPrompt,
  objectiveReviewPrompt,
  productReviewPrompt,
  designReviewPrompt,
  planReviewPrompt,
  executeMilestonePrompt,
  donePrompt,
  chatPrompt,
} from "../../src/claude/prompts.js";
import type { TaskContext } from "../../src/pipeline/types.js";

const CTX: TaskContext = {
  taskNumber: 42,
  title: "Add login flow",
  slug: "add-login-flow",
  plansDir: "plans",
  planPath: "plans/0042_add-login-flow",
  branchName: "vibe-racer/0042_add-login-flow",
  cwd: "/tmp/repo",
  contextFiles: ["README.md", "CLAUDE.md"],
};

describe("PERSONAS", () => {
  it("has three distinct persona strings", () => {
    expect(PERSONAS.productDesigner).toContain("Product Designer");
    expect(PERSONAS.uxDataArchitect).toContain("Architect");
    expect(PERSONAS.softwareEngineer).toContain("Software Engineer");
  });

  it("personas are opinionated", () => {
    expect(PERSONAS.productDesigner).toContain("opinionated");
    expect(PERSONAS.uxDataArchitect).toContain("opinionated");
  });
});

describe("constants", () => {
  it("MAX_QUESTIONS_PER_ROUND is 6", () => {
    expect(MAX_QUESTIONS_PER_ROUND).toBe(6);
  });

  it("MAX_QUESTION_ROUNDS is 3", () => {
    expect(MAX_QUESTION_ROUNDS).toBe(3);
  });
});

describe("followUpSectionHeading", () => {
  it("formats round 2 of 3", () => {
    expect(followUpSectionHeading(2, 3)).toBe("## Follow-up Questions (Round 2 of 3)");
  });

  it("formats round 3 of 3", () => {
    expect(followUpSectionHeading(3, 3)).toBe("## Follow-up Questions (Round 3 of 3)");
  });
});

describe("forcedSpecPrompt", () => {
  it("returns prompt containing task number, title, and spec description", () => {
    const result = forcedSpecPrompt(CTX, "product specification", PERSONAS.productDesigner);
    expect(result.prompt).toContain("#42");
    expect(result.prompt).toContain("Add login flow");
    expect(result.prompt).toContain("product specification");
  });

  it("returns the passed persona unchanged", () => {
    const result = forcedSpecPrompt(CTX, "product specification", PERSONAS.productDesigner);
    expect(result.persona).toBe(PERSONAS.productDesigner);
  });
});

describe("objectiveReviewPrompt", () => {
  it("references the objective file path", () => {
    const { prompt } = objectiveReviewPrompt(CTX);
    expect(prompt).toContain("plans/0042_add-login-flow/00_objective.md");
  });

  it("references the output file path", () => {
    const { prompt } = objectiveReviewPrompt(CTX);
    expect(prompt).toContain("plans/0042_add-login-flow/01_product_questions.md");
  });

  it("includes task number and title", () => {
    const { prompt } = objectiveReviewPrompt(CTX);
    expect(prompt).toContain("task #42");
    expect(prompt).toContain("Add login flow");
  });

  it("includes context files instruction", () => {
    const { prompt } = objectiveReviewPrompt(CTX);
    expect(prompt).toContain("README.md");
    expect(prompt).toContain("CLAUDE.md");
  });

  it("includes question format specification", () => {
    const { prompt } = objectiveReviewPrompt(CTX);
    expect(prompt).toContain("**Answer:**");
    expect(prompt).toContain("### Q{N}");
  });

  it("uses productDesigner persona", () => {
    const { persona } = objectiveReviewPrompt(CTX);
    expect(persona).toBe(PERSONAS.productDesigner);
  });

  it("contains 5-6 questions cap", () => {
    const { prompt } = objectiveReviewPrompt(CTX);
    expect(prompt).toContain("5-6 questions");
    expect(prompt).toContain("never more than 6");
  });

  it("contains prioritization text", () => {
    const { prompt } = objectiveReviewPrompt(CTX);
    expect(prompt).toContain("constrain the design space");
  });

  it("does NOT contain old 10-25 question count", () => {
    const { prompt } = objectiveReviewPrompt(CTX);
    expect(prompt).not.toContain("10-25");
  });

  it("includes trivial task detection section", () => {
    const { prompt } = objectiveReviewPrompt(CTX);
    expect(prompt).toContain("Trivial task detection");
    expect(prompt).toContain("well-defined, bounded change");
    expect(prompt).toContain("no new or basic changes");
    expect(prompt).toContain("No architectural decisions");
    expect(prompt).toContain("~3-4 files changed");
  });
});

describe("productReviewPrompt", () => {
  it("references input and output files", () => {
    const { prompt } = productReviewPrompt(CTX);
    expect(prompt).toContain("01_product_questions.md");
    expect(prompt).toContain("01_product.md");
    expect(prompt).toContain("02_design_questions.md");
  });

  it("instructs to create TWO files", () => {
    const { prompt } = productReviewPrompt(CTX);
    expect(prompt).toContain("TWO files");
  });

  it("includes follow-up handling instruction", () => {
    const { prompt } = productReviewPrompt(CTX);
    expect(prompt).toContain("Follow-up");
    expect(prompt).toContain("01_product_questions.md");
  });

  it("without round: no round context, contains 5-6 questions", () => {
    const { prompt } = productReviewPrompt(CTX);
    expect(prompt).not.toContain("Round context");
    expect(prompt).toContain("5-6 questions");
  });

  it("with round=2: contains round context and cross-referencing", () => {
    const { prompt } = productReviewPrompt(CTX, 2);
    expect(prompt).toContain("1 round(s) of questions");
    expect(prompt).toContain("reference the human's previous answers");
  });

  it("with round=3: contains MUST produce the spec", () => {
    const { prompt } = productReviewPrompt(CTX, 3);
    expect(prompt).toContain("MUST produce the spec");
  });

  it("follow-up heading includes round counter format", () => {
    const { prompt } = productReviewPrompt(CTX, 1);
    expect(prompt).toContain("Follow-up Questions (Round 2 of 3)");
  });
});

describe("designReviewPrompt", () => {
  it("references input and output files", () => {
    const { prompt } = designReviewPrompt(CTX);
    expect(prompt).toContain("02_design_questions.md");
    expect(prompt).toContain("02_design.md");
    expect(prompt).toContain("03_plan_questions.md");
  });

  it("uses uxDataArchitect persona", () => {
    const { persona } = designReviewPrompt(CTX);
    expect(persona).toBe(PERSONAS.uxDataArchitect);
  });

  it("includes follow-up handling instruction", () => {
    const { prompt } = designReviewPrompt(CTX);
    expect(prompt).toContain("Follow-up");
    expect(prompt).toContain("02_design_questions.md");
  });

  it("without round: no round context", () => {
    const { prompt } = designReviewPrompt(CTX);
    expect(prompt).not.toContain("Round context");
  });

  it("with round=2: contains round context", () => {
    const { prompt } = designReviewPrompt(CTX, 2);
    expect(prompt).toContain("1 round(s) of questions");
  });

  it("with round=3: contains MUST produce the spec", () => {
    const { prompt } = designReviewPrompt(CTX, 3);
    expect(prompt).toContain("MUST produce the spec");
  });
});

describe("planReviewPrompt", () => {
  it("references input and output files", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).toContain("03_plan_questions.md");
    expect(prompt).toContain("03_plan.md");
    expect(prompt).toContain("04_execute.md");
  });

  it("describes execution status table format", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).toContain("pending");
    expect(prompt).toContain("in_progress");
    expect(prompt).toContain("done");
  });

  it("uses softwareEngineer persona", () => {
    const { persona } = planReviewPrompt(CTX);
    expect(persona).toBe(PERSONAS.softwareEngineer);
  });

  it("includes follow-up handling instruction", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).toContain("Follow-up");
    expect(prompt).toContain("03_plan_questions.md");
  });

  it("without round: no round context", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).not.toContain("Round context");
  });

  it("with round=2: contains round context", () => {
    const { prompt } = planReviewPrompt(CTX, 2);
    expect(prompt).toContain("1 round(s) of questions");
  });

  it("with round=3: contains MUST produce the spec", () => {
    const { prompt } = planReviewPrompt(CTX, 3);
    expect(prompt).toContain("MUST produce the spec");
  });

  it("includes product and design spec refs for non-trivial tasks", () => {
    const { prompt } = planReviewPrompt({ ...CTX, trivial: false });
    expect(prompt).toContain("01_product.md");
    expect(prompt).toContain("02_design.md");
  });

  it("omits product and design spec refs for trivial tasks", () => {
    const { prompt } = planReviewPrompt({ ...CTX, trivial: true });
    expect(prompt).not.toContain("01_product.md");
    expect(prompt).not.toContain("02_design.md");
  });
});

describe("executeMilestonePrompt", () => {
  it("references execution playbook and plan", () => {
    const { prompt } = executeMilestonePrompt(CTX);
    expect(prompt).toContain("04_execute.md");
    expect(prompt).toContain("03_plan.md");
  });

  it("includes build and test verification", () => {
    const { prompt } = executeMilestonePrompt(CTX);
    expect(prompt).toContain("npm run build");
    expect(prompt).toContain("npm run test");
  });

  it("includes product and design spec refs for non-trivial tasks", () => {
    const { prompt } = executeMilestonePrompt({ ...CTX, trivial: false });
    expect(prompt).toContain("01_product.md");
    expect(prompt).toContain("02_design.md");
  });

  it("omits product and design spec refs for trivial tasks", () => {
    const { prompt } = executeMilestonePrompt({ ...CTX, trivial: true });
    expect(prompt).not.toContain("01_product.md");
    expect(prompt).not.toContain("02_design.md");
  });
});

describe("donePrompt", () => {
  it("references plan and playbook files", () => {
    const { prompt } = donePrompt(CTX);
    expect(prompt).toContain("03_plan.md");
    expect(prompt).toContain("04_execute.md");
  });

  it("includes lint step", () => {
    const { prompt } = donePrompt(CTX);
    expect(prompt).toContain("npm run lint");
  });

  it("includes product and design spec refs for non-trivial tasks", () => {
    const { prompt } = donePrompt({ ...CTX, trivial: false });
    expect(prompt).toContain("01_product.md");
    expect(prompt).toContain("02_design.md");
  });

  it("omits product and design spec refs for trivial tasks", () => {
    const { prompt } = donePrompt({ ...CTX, trivial: true });
    expect(prompt).not.toContain("01_product.md");
    expect(prompt).not.toContain("02_design.md");
  });
});

describe("chatPrompt", () => {
  it("returns productDesigner persona for need_objective", () => {
    const { systemPrompt } = chatPrompt(CTX, "need_objective");
    expect(systemPrompt).toContain(PERSONAS.productDesigner);
  });

  it("returns productDesigner persona for need_product", () => {
    const { systemPrompt } = chatPrompt(CTX, "need_product");
    expect(systemPrompt).toContain(PERSONAS.productDesigner);
  });

  it("returns uxDataArchitect persona for need_design", () => {
    const { systemPrompt } = chatPrompt(CTX, "need_design");
    expect(systemPrompt).toContain(PERSONAS.uxDataArchitect);
  });

  it("returns softwareEngineer persona for need_plan", () => {
    const { systemPrompt } = chatPrompt(CTX, "need_plan");
    expect(systemPrompt).toContain(PERSONAS.softwareEngineer);
  });

  it("returns softwareEngineer persona for need_execution", () => {
    const { systemPrompt } = chatPrompt(CTX, "need_execution");
    expect(systemPrompt).toContain(PERSONAS.softwareEngineer);
  });

  it("returns softwareEngineer persona for fine_tuning", () => {
    const { systemPrompt } = chatPrompt(CTX, "fine_tuning");
    expect(systemPrompt).toContain(PERSONAS.softwareEngineer);
  });

  it("system prompt contains 'do not produce full pipeline artifacts' for non-fine-tuning stages", () => {
    for (const stage of ["need_objective", "need_product", "need_design", "need_plan", "need_execution"] as const) {
      const { systemPrompt } = chatPrompt(CTX, stage);
      expect(systemPrompt).toContain("do not produce full pipeline artifacts");
    }
  });

  it("system prompt does NOT contain 'do not produce full pipeline artifacts' for fine_tuning", () => {
    const { systemPrompt } = chatPrompt(CTX, "fine_tuning");
    expect(systemPrompt).not.toContain("do not produce full pipeline artifacts");
  });

  it("system prompt contains 'Do not tick completion checkboxes' for all stages including fine_tuning", () => {
    for (const stage of ["need_objective", "need_product", "need_design", "need_plan", "need_execution", "fine_tuning"] as const) {
      const { systemPrompt } = chatPrompt(CTX, stage);
      expect(systemPrompt).toContain("Do not tick completion checkboxes");
    }
  });

  it("system prompt contains task number and title", () => {
    const { systemPrompt } = chatPrompt(CTX, "need_plan");
    expect(systemPrompt).toContain("#42");
    expect(systemPrompt).toContain("Add login flow");
  });

  it("initial message contains plan path and context files", () => {
    const { initialMessage } = chatPrompt(CTX, "need_plan");
    expect(initialMessage).toContain("plans/0042_add-login-flow/");
    expect(initialMessage).toContain("`README.md`");
    expect(initialMessage).toContain("`CLAUDE.md`");
  });

  it("system prompt for fine_tuning contains 'small coding changes'", () => {
    const { systemPrompt } = chatPrompt(CTX, "fine_tuning");
    expect(systemPrompt).toContain("small coding changes");
  });
});
