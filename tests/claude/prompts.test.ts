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
  qaPrompt,
  decisionPrompt,
} from "../../src/claude/prompts.js";
import type { TaskContext } from "../../src/pipeline/types.js";
import { MILESTONE_STATUSES, OWNERS } from "../../src/pipeline/execute-table.js";
import { OPERATOR_RESUME_MARKER } from "../../src/pipeline/operator-block.js";

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

const MILESTONE = { id: "M3", name: "Wire the parser" };

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

  // The contract test (I1): the prompt is built FROM the unions, so a status or owner the
  // handler knows is always one the planner is told about — `blocked` was the drift bug.
  it("contract — every MILESTONE_STATUSES and OWNERS member appears in the prompt", () => {
    const { prompt } = planReviewPrompt(CTX);
    for (const status of MILESTONE_STATUSES) expect(prompt).toContain(`\`${status}\``);
    for (const owner of OWNERS) expect(prompt).toContain(`\`${owner}\``);
  });

  it("no longer contains the word blocked", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).not.toContain("blocked");
  });

  it("describes the Owner column, G<n> IDs and the gate categories", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).toContain("`Owner`");
    expect(prompt).toContain("`G<n>`");
    expect(prompt).toContain("## G<n> — <name>");
    for (const category of [
      "prerequisite PR",
      "code review",
      "credentials or secrets",
      "external service or dashboard",
      "visual or screenshot check",
      "soak or wait period",
      "anything outside the repository",
    ]) {
      expect(prompt).toContain(category);
    }
  });

  it("requires the per-gate Verification line, with the operator's-word fallback", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).toContain("`**Verification:**` line");
    expect(prompt).toContain("**Verification:** None — operator's word");
  });

  it("requires the Operator gates section above the sign-off checkbox, with an explicit none", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).toContain("## Operator gates in this plan");
    expect(prompt).toContain("immediately above the `# Complete` checkbox");
    expect(prompt).toContain("None — execution runs start to finish without you.");
  });

  it("runs continuously between operator gates, not without pausing", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).toContain("running continuously between operator gates");
    expect(prompt).not.toContain("without pausing");
  });

  it("D11 — states the counter-rule in both placements", () => {
    const { prompt } = planReviewPrompt(CTX);
    // Once in the File-2 structure list, once in the table rules.
    expect(prompt).toContain("every gate row is followed by the agent milestone it unblocks");
    expect(prompt).toContain("Every gate row must have at least one agent milestone after it");
    expect(prompt).toContain("Merge, tag, release and deploy of this task's own work are not rows");
    expect(prompt).toContain("Merging this task's PR, tagging, releasing and deploying are never rows");
  });

  it("D11 — does not invite a post-milestone or human-steps table", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).not.toMatch(/post-milestone/i);
    expect(prompt).not.toMatch(/human steps/i);
    expect(prompt).toContain("What happens *after* the last milestone is not in this plan at all");
  });

  it("interpolates EXECUTION_TABLE_SPEC verbatim, worked example included", () => {
    const { prompt } = planReviewPrompt(CTX);
    expect(prompt).toContain("### The milestone status table");
    expect(prompt).toContain("| G1 | Operator merges PRs #12 and #14 |");
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
    const { prompt } = executeMilestonePrompt(CTX, MILESTONE);
    expect(prompt).toContain("04_execute.md");
    expect(prompt).toContain("03_plan.md");
  });

  it("includes build and test verification", () => {
    const { prompt } = executeMilestonePrompt(CTX, MILESTONE);
    expect(prompt).toContain("npm run build");
    expect(prompt).toContain("npm run test");
  });

  it("includes product and design spec refs for non-trivial tasks", () => {
    const { prompt } = executeMilestonePrompt({ ...CTX, trivial: false }, MILESTONE);
    expect(prompt).toContain("01_product.md");
    expect(prompt).toContain("02_design.md");
  });

  it("omits product and design spec refs for trivial tasks", () => {
    const { prompt } = executeMilestonePrompt({ ...CTX, trivial: true }, MILESTONE);
    expect(prompt).not.toContain("01_product.md");
    expect(prompt).not.toContain("02_design.md");
  });

  it("contract — every MILESTONE_STATUSES and OWNERS member appears in the prompt", () => {
    const { prompt } = executeMilestonePrompt(CTX, MILESTONE);
    for (const status of MILESTONE_STATUSES) expect(prompt).toContain(`\`${status}\``);
    for (const owner of OWNERS) expect(prompt).toContain(`\`${owner}\``);
  });

  it("names the milestone the handler chose instead of telling the agent to find one", () => {
    const { prompt } = executeMilestonePrompt(CTX, MILESTONE);
    expect(prompt).toContain("**M3 — Wire the parser**");
    expect(prompt).toContain("the milestone named in this prompt");
    expect(prompt).toContain("Execute ONLY the milestone named above");
    expect(prompt).not.toContain("Find the FIRST");
    expect(prompt).not.toContain("first pending milestone");
  });

  it("falls back to the bare ID when the row has no name", () => {
    const { prompt } = executeMilestonePrompt(CTX, { id: "M5a", name: "" });
    expect(prompt).toContain("**M5a**");
    expect(prompt).not.toContain("**M5a — ");
  });

  it("carries the needs_operator protocol", () => {
    const { prompt } = executeMilestonePrompt(CTX, MILESTONE);
    expect(prompt).toContain("`needs_operator` protocol");
    expect(prompt).toContain("do **not** attempt it");
    expect(prompt).toContain("do **not** work around it");
    expect(prompt).toContain("do **not** start a later milestone");
    expect(prompt).toContain("End the session");
  });

  it("interpolates PAUSE_BLOCK_SPEC with its fenced example and the real resume marker", () => {
    const { prompt } = executeMilestonePrompt(CTX, MILESTONE);
    expect(prompt).toContain("### The operator pause block");
    expect(prompt).toContain("```markdown\n## Operator actions — pause 1 (G1)");
    expect(prompt).toContain(`- [ ] ${OPERATOR_RESUME_MARKER}`);
  });

  it("states the no-push / no-PR / no-deploy rule", () => {
    const { prompt } = executeMilestonePrompt(CTX, MILESTONE);
    expect(prompt).toContain("You never push, open PRs, merge PRs or deploy.");
  });

  it("D11 — says the lap ends at the last agent milestone and merge/tag come after QA", () => {
    const { prompt } = executeMilestonePrompt(CTX, MILESTONE);
    expect(prompt).toContain("Execution ends at the last agent milestone.");
    expect(prompt).toContain("Merging this task's PR, tagging and deploying happen after the QA lap");
    expect(prompt).toContain("leave it exactly as it is — do not run it, do not mark it, do not `needs_operator` it");
  });

  it("describes gate verification with the fallback ladder", () => {
    const { prompt } = executeMilestonePrompt(CTX, MILESTONE);
    expect(prompt).toContain("## Gate verification");
    for (const cmd of ["`git fetch`", "`git log`", "`git merge-base`", "`gh pr view`"]) {
      expect(prompt).toContain(cmd);
    }
    expect(prompt).toContain("fall back to local refs");
    expect(prompt).toContain("**take the operator's tick as the answer** and say so in your session output");
  });

  it("uses softwareEngineer persona", () => {
    const { persona } = executeMilestonePrompt(CTX, MILESTONE);
    expect(persona).toBe(PERSONAS.softwareEngineer);
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

  it("returns qaEngineer persona for fine_tuning (updated in M5a)", () => {
    const { systemPrompt } = chatPrompt(CTX, "fine_tuning");
    expect(systemPrompt).toContain(PERSONAS.qaEngineer);
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

  it("returns qaEngineer persona for fine_tuning", () => {
    const { systemPrompt } = chatPrompt(CTX, "fine_tuning");
    expect(systemPrompt).toContain(PERSONAS.qaEngineer);
  });

  it("returns releaseManager persona for need_decision", () => {
    const { systemPrompt } = chatPrompt(CTX, "need_decision");
    expect(systemPrompt).toContain(PERSONAS.releaseManager);
  });

  it("AC18 — need_operator carries the pause role description and the softwareEngineer persona", () => {
    const { systemPrompt } = chatPrompt(CTX, "need_operator");
    expect(systemPrompt).toContain(PERSONAS.softwareEngineer);
    expect(systemPrompt).toContain("The task is paused waiting on you.");
    expect(systemPrompt).toContain("Read the last 'Operator actions' block in 04_execute.md.");
    expect(systemPrompt).toContain("help reword or split the milestone");
  });

  it("AC18 — need_operator carries the resume-marker guardrail; other stages do not", () => {
    const guardrail =
      "Do not push, open PRs, merge or deploy, and do not tick the resume marker — that is the operator's.";
    expect(chatPrompt(CTX, "need_operator").systemPrompt).toContain(guardrail);
    expect(chatPrompt(CTX, "need_operator").systemPrompt).toContain("Do not tick completion checkboxes");
    for (const stage of ["need_execution", "fine_tuning", "need_decision"] as const) {
      expect(chatPrompt(CTX, stage).systemPrompt).not.toContain(guardrail);
    }
  });
});

describe("qaPrompt", () => {
  it("includes adversarial framing", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).toContain("YOUR JOB IS TO FIND PROBLEMS");
    expect(prompt).toMatch(/red\s+flag, not a success/);
  });

  it("includes all six mandatory sections", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).toContain("**What works**");
    expect(prompt).toContain("**What doesn't**");
    expect(prompt).toContain("**What regressed**");
    expect(prompt).toContain("**Deviations**");
    expect(prompt).toContain("**Risks and known limitations**");
    expect(prompt).toContain("**Verification run**");
  });

  it("includes git diff scoping instruction", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).toContain("git diff --stat main...HEAD");
    expect(prompt).toContain("git log --oneline main..HEAD");
  });

  it("references context files: objective, plan, execute", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).toContain("00_objective.md");
    expect(prompt).toContain("03_plan.md");
    expect(prompt).toContain("04_execute.md");
  });

  it("instructs to write 05_qa.md", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).toContain("05_qa.md");
  });

  it("uses qaEngineer persona", () => {
    const { persona } = qaPrompt(CTX, []);
    expect(persona).toBe(PERSONAS.qaEngineer);
  });

  it("includes rule: do not fix issues", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).toContain("Do NOT fix any issues you find");
  });

  it("does not reference the deleted vibe-racer-fix.md handoff note", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).not.toContain("vibe-racer-fix.md");
  });

  it("forbids authoring the completion section", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).toContain("Do NOT add a \"# Complete\" section");
  });

  it("includes diff fallback clause", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).toContain("Fall back to reviewing every");
  });

  it("AC19 — with no gates, omits the coverage requirement", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).not.toContain("Operator gates this task paused at");
    expect(prompt).not.toContain("was not reviewed here");
  });

  it("AC19 — with gates, lists them and requires the report to open with its coverage", () => {
    const { prompt } = qaPrompt(CTX, ["G1 — PRs merged into main", "G2 — Storybook check"]);
    expect(prompt).toContain("## Operator gates this task paused at");
    expect(prompt).toContain("- G1 — PRs merged into main");
    expect(prompt).toContain("- G2 — Storybook check");
    expect(prompt).toContain("Your\nreport MUST open with its coverage");
    expect(prompt).toContain("This task paused at G1 (PRs merged into main). Work merged before that gate is outside");
    expect(prompt).toContain("`git diff main...HEAD` and was not reviewed here.");
  });

  it("scopes the review to code and defers doc freshness to the cleanup lap", () => {
    const { prompt } = qaPrompt(CTX, []);
    expect(prompt).toContain("BEFORE the cleanup lap");
    expect(prompt).toContain("do NOT report stale or missing project documentation");
    // The carve-out matters as much as the rule: a doc item the plan made an acceptance
    // criterion is execution scope, and QA must still catch it.
    expect(prompt).toContain("One exception");
  });
});

describe("decisionPrompt", () => {
  it("references 06_decision.md", () => {
    const { prompt } = decisionPrompt(CTX);
    expect(prompt).toContain("06_decision.md");
  });

  it("asks for flat top-level checkboxes", () => {
    const { prompt } = decisionPrompt(CTX);
    expect(prompt).toContain("flat, top-level");
    expect(prompt).toContain("- [ ]");
  });

  it("forbids authoring the completion section", () => {
    const { prompt } = decisionPrompt(CTX);
    expect(prompt).toContain("Do NOT add a \"# Complete\" section");
  });

  it("references context files: objective, plan, qa", () => {
    const { prompt } = decisionPrompt(CTX);
    expect(prompt).toContain("00_objective.md");
    expect(prompt).toContain("03_plan.md");
    expect(prompt).toContain("05_qa.md");
  });

  it("uses releaseManager persona", () => {
    const { persona } = decisionPrompt(CTX);
    expect(persona).toBe(PERSONAS.releaseManager);
  });

  it("mentions residual risks", () => {
    const { prompt } = decisionPrompt(CTX);
    expect(prompt).toContain("residual risk");
  });
});

describe("chatPrompt — need_decision persona", () => {
  it("CHAT_PERSONA_MAP['need_decision'] resolves to releaseManager", () => {
    const { systemPrompt } = chatPrompt(CTX, "need_decision");
    expect(systemPrompt).toContain(PERSONAS.releaseManager);
  });
});

describe("PERSONAS", () => {
  it("has qaEngineer persona", () => {
    expect(PERSONAS.qaEngineer).toContain("QA Engineer");
    expect(PERSONAS.qaEngineer).toContain("judge");
  });

  it("has releaseManager persona", () => {
    expect(PERSONAS.releaseManager).toContain("Release Manager");
    expect(PERSONAS.releaseManager).toContain("post-deploy");
  });
});
