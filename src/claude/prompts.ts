import type { TaskContext } from "../pipeline/types.js";
import type { Stage } from "../state/schema.js";

export const PERSONAS = {
  productDesigner: [
    "You are a **Senior Product Designer** working on a software project.",
    "You excel at turning vague ideas into structured, actionable product specifications.",
    "You think in terms of user journeys, edge cases, scope boundaries, and acceptance criteria.",
    "You ask precise, opinionated questions and pre-fill each answer with your concrete recommendation.",
    "You never produce implementation details or code — only product-level decisions.",
  ].join(" "),

  uxDataArchitect: [
    "You are a **Senior Software Architect and UX/Data Designer**.",
    "You translate product requirements into technical design specifications.",
    "You think in terms of module boundaries, data models, API contracts, and integration patterns.",
    "You ask precise, opinionated questions and pre-fill each answer with your concrete recommendation.",
    "You produce architecture documents, not code.",
  ].join(" "),

  softwareEngineer: [
    "You are a **Senior Software Engineer**.",
    "You write clean, well-tested code and thorough implementation plans.",
    "You think in terms of milestones, task decomposition, dependency order, and testability.",
    "You ask practical questions about build order, testing strategy, and deployment.",
    "When executing, you follow the plan precisely and commit working code.",
  ].join(" "),
} as const;

export const MAX_QUESTIONS_PER_ROUND = 6;
export const MAX_QUESTION_ROUNDS = 3;

export function followUpSectionHeading(round: number, maxRounds: number): string {
  return `## Follow-up Questions (Round ${round} of ${maxRounds})`;
}

function contextFilesInstruction(ctx: TaskContext): string {
  if (ctx.contextFiles.length === 0) return "";
  return `\nRead these project context files first (if they exist): ${ctx.contextFiles.map((f) => `\`${f}\``).join(", ")}.\n`;
}

function questionFormat(
  nextStageName: string,
  round?: { current: number; max: number },
): string {
  let text = `
Use this format for each question:

### Q{N}: {Short title}

{Your question. Be specific and opinionated.}

**Answer:**
{Your recommended answer. Write a concrete, actionable recommendation — not a vague suggestion. The human will review and only edit what they disagree with.}

Group questions under thematic section headings (## headings).
Number questions sequentially across all sections (Q1, Q2, Q3...).
Generate 5-6 questions (never more than ${MAX_QUESTIONS_PER_ROUND}). Ask the 5-6 questions whose answers would most constrain the design space. Save detail questions for follow-ups if needed.

**IMPORTANT:** End the file with a completion checkbox section:

\`\`\`
# Complete

- [ ] Ready to advance to ${nextStageName}
\`\`\`

The human will tick this checkbox when they have finished reviewing/editing the answers.
`.trim();

  if (round) {
    text += `\n\nIf you need to request follow-up questions, use the heading: \`${followUpSectionHeading(round.current + 1, round.max)}\``;
  }

  return text;
}

export function objectiveReviewPrompt(ctx: TaskContext): {
  prompt: string;
  persona: string;
} {
  const prompt = `
You are reviewing the objective for task #${ctx.taskNumber}: "${ctx.title}".
${contextFilesInstruction(ctx)}
## Your task

1. Read the objective file at \`${ctx.planPath}/00_objective.md\`
2. Read any project context files listed above
3. Assess whether the objective is clear enough to generate product-scoping questions
4. Generate a comprehensive set of product questions

## Output

Write a single file: \`${ctx.planPath}/01_product_questions.md\`

The file must start with:

\`\`\`
# Product Questions for #${ctx.taskNumber}: ${ctx.title}

> **Role**: Senior Product Designer
> **Stage**: \`ai_objective_review\` → \`need_product\`
> **Date**: ${new Date().toISOString().split("T")[0]}

---
\`\`\`

${questionFormat("Product Review")}

## Trivial task detection

Before generating product questions, assess whether this task is **trivial**. A task is trivial if it meets ALL of these criteria:

1. The objective describes a well-defined, bounded change (not open-ended)
2. It requires no new or basic changes to existing user-facing workflows or UX decisions
3. No architectural decisions or new patterns are needed — only existing patterns
4. The estimated scope is ~3-4 files changed

**Examples of trivial tasks:** renaming a function, fixing a display bug, removing a feature, adding a CLI flag with obvious behavior.
**Examples of non-trivial tasks:** adding a new pipeline stage, redesigning the status output, integrating a new external service.

### If trivial:

1. Read the current \`${ctx.planPath}/state.yml\`, preserve all existing fields
2. Add \`trivial: true\` to the state:
   \`\`\`yaml
   stage: ai_objective_review
   title: "..."
   trivial: true
   \`\`\`
3. Write \`${ctx.planPath}/03_plan_questions.md\` (skipping product and design stages) with this header:
   \`\`\`
   # Plan Questions for #${ctx.taskNumber}: ${ctx.title}

   > **Role**: Senior Software Engineer
   > **Stage**: \`ai_objective_review\` → \`need_plan\` (trivial fast-path)
   > **Date**: ${new Date().toISOString().split("T")[0]}

   ---
   \`\`\`
   Then generate plan questions using the same Q&A format described above, ending with the completion checkbox: \`- [ ] Ready to advance to Plan Review\`
4. Do NOT write \`01_product_questions.md\`

### If not trivial:

Proceed normally — write \`${ctx.planPath}/01_product_questions.md\` as described above. Do NOT set \`trivial\` in state.yml.

## Rules

- Focus on PRODUCT decisions: user experience, scope, edge cases, workflows, error handling from the user's perspective
- Do NOT ask about implementation, architecture, or technology choices — those come in design questions
- Do NOT generate a product spec yet — only questions
- Each question should help define a specific product boundary or behavior
- Pre-fill every **Answer:** with your recommended answer — the human will only change what they disagree with
`.trim();

  return { prompt, persona: PERSONAS.productDesigner };
}

export function productReviewPrompt(
  ctx: TaskContext,
  round?: number,
): {
  prompt: string;
  persona: string;
} {
  const nextRound = (round ?? 1) + 1;
  const roundContext = round && round > 1
    ? `
## Round context

The human has already answered ${round - 1} round(s) of questions. Their previous answers are visible in the file above.
You have ${MAX_QUESTION_ROUNDS - round + 1} round(s) remaining including this one.
When generating follow-up questions, reference the human's previous answers where relevant (e.g., "Given your preference for X in Q2, we recommend...").
${round >= MAX_QUESTION_ROUNDS ? "\n**You MUST produce the spec in this round. Do not request more follow-ups.**\n" : ""}`
    : "";

  const prompt = `
You are reviewing the product answers for task #${ctx.taskNumber}: "${ctx.title}".
${contextFilesInstruction(ctx)}
## Your task

1. Read the objective: \`${ctx.planPath}/00_objective.md\`
2. Read the answered product questions: \`${ctx.planPath}/01_product_questions.md\`
3. Read any project context files listed above
4. Generate a comprehensive product specification
5. Generate design/architecture questions for the next stage
${roundContext}
## Output — TWO files

### File 1: \`${ctx.planPath}/01_product.md\`

A comprehensive product specification document. Structure it with:
- Table of Contents
- Product Overview
- Detailed feature specifications based on the answers
- State machine / workflow descriptions
- Configuration and prerequisites
- Edge cases and error recovery
- Scope boundaries (what's in, what's out)
- Acceptance criteria

Reference the answers directly. Every product decision should trace back to a Q&A.

### File 2: \`${ctx.planPath}/02_design_questions.md\`

Design/architecture questions for the next stage. The file must start with:

\`\`\`
# Design Questions for #${ctx.taskNumber}: ${ctx.title}

> **Role**: Senior Software Architect
> **Stage**: \`ai_product_review\` → \`need_design\`
> **Date**: ${new Date().toISOString().split("T")[0]}

---
\`\`\`

${questionFormat("Design Review", round ? { current: round, max: MAX_QUESTION_ROUNDS } : undefined)}

## Follow-up handling

If the answers are filled in but insufficient for producing a quality product specification,
do NOT produce the spec. Instead, append a \`${followUpSectionHeading(nextRound, MAX_QUESTION_ROUNDS)}\` section to
\`${ctx.planPath}/01_product_questions.md\` with additional questions using the same format
(including pre-filled recommended answers). Also uncheck the completion checkbox at the bottom
(change \`- [x]\` to \`- [ ]\`). This signals that more information is needed.

## Rules for design questions

- Focus on ARCHITECTURE decisions: module structure, data models, libraries, API design, integration patterns
- Do NOT ask about product decisions — those are already answered
- Do NOT generate a design spec yet — only questions
- Each question should help define a specific technical boundary or pattern
- Pre-fill every **Answer:** with your recommended answer — the human will only change what they disagree with
`.trim();

  return { prompt, persona: PERSONAS.productDesigner };
}

export function designReviewPrompt(
  ctx: TaskContext,
  round?: number,
): {
  prompt: string;
  persona: string;
} {
  const nextRound = (round ?? 1) + 1;
  const roundContext = round && round > 1
    ? `
## Round context

The human has already answered ${round - 1} round(s) of questions. Their previous answers are visible in the file above.
You have ${MAX_QUESTION_ROUNDS - round + 1} round(s) remaining including this one.
When generating follow-up questions, reference the human's previous answers where relevant (e.g., "Given your preference for X in Q2, we recommend...").
${round >= MAX_QUESTION_ROUNDS ? "\n**You MUST produce the spec in this round. Do not request more follow-ups.**\n" : ""}`
    : "";

  const prompt = `
You are reviewing the design answers for task #${ctx.taskNumber}: "${ctx.title}".
${contextFilesInstruction(ctx)}
## Your task

1. Read the objective: \`${ctx.planPath}/00_objective.md\`
2. Read the product spec: \`${ctx.planPath}/01_product.md\`
3. Read the answered design questions: \`${ctx.planPath}/02_design_questions.md\`
4. Read any project context files listed above
5. Generate a comprehensive design/architecture specification
6. Generate implementation planning questions for the next stage
${roundContext}
## Output — TWO files

### File 1: \`${ctx.planPath}/02_design.md\`

A comprehensive design specification document. Structure it with:
- Table of Contents
- Architecture Overview (with ASCII diagrams where helpful)
- Project/directory structure
- Module descriptions with interfaces and key types
- Integration patterns (external services, SDKs)
- State management design
- Data flow descriptions
- Configuration and environment
- Testing strategy
- Build and distribution
- Dependency summary

Reference the design answers directly. Every architecture decision should trace back to a Q&A.

### File 2: \`${ctx.planPath}/03_plan_questions.md\`

Implementation planning questions for the next stage. The file must start with:

\`\`\`
# Plan Questions for #${ctx.taskNumber}: ${ctx.title}

> **Role**: Senior Software Engineer
> **Stage**: \`ai_design_review\` → \`need_plan\`
> **Date**: ${new Date().toISOString().split("T")[0]}

---
\`\`\`

${questionFormat("Plan Review", round ? { current: round, max: MAX_QUESTION_ROUNDS } : undefined)}

## Follow-up handling

If the answers are filled in but insufficient for producing a quality design specification,
do NOT produce the spec. Instead, append a \`${followUpSectionHeading(nextRound, MAX_QUESTION_ROUNDS)}\` section to
\`${ctx.planPath}/02_design_questions.md\` with additional questions using the same format
(including pre-filled recommended answers). Also uncheck the completion checkbox at the bottom
(change \`- [x]\` to \`- [ ]\`). This signals that more information is needed.

## Rules for plan questions

- Focus on EXECUTION decisions: milestone ordering, build sequence, testing approach, deployment
- Do NOT ask about architecture or product — those are already decided
- Do NOT generate a plan yet — only questions
- Each question should help determine HOW to build, not WHAT to build
- Pre-fill every **Answer:** with your recommended answer — the human will only change what they disagree with
`.trim();

  return { prompt, persona: PERSONAS.uxDataArchitect };
}

export function planReviewPrompt(
  ctx: TaskContext,
  round?: number,
): {
  prompt: string;
  persona: string;
} {
  const nextRound = (round ?? 1) + 1;
  const roundContext = round && round > 1
    ? `
## Round context

The human has already answered ${round - 1} round(s) of questions. Their previous answers are visible in the file above.
You have ${MAX_QUESTION_ROUNDS - round + 1} round(s) remaining including this one.
When generating follow-up questions, reference the human's previous answers where relevant (e.g., "Given your preference for X in Q2, we recommend...").
${round >= MAX_QUESTION_ROUNDS ? "\n**You MUST produce the spec in this round. Do not request more follow-ups.**\n" : ""}`
    : "";

  const specSteps = ctx.trivial === true
    ? ""
    : `2. Read the product spec: \`${ctx.planPath}/01_product.md\`
3. Read the design spec: \`${ctx.planPath}/02_design.md\`
`;
  const stepOffset = ctx.trivial === true ? 1 : 3;
  const prompt = `
You are reviewing the plan answers for task #${ctx.taskNumber}: "${ctx.title}".
${contextFilesInstruction(ctx)}
## Your task

1. Read the objective: \`${ctx.planPath}/00_objective.md\`
${specSteps}${stepOffset + 1}. Read the answered plan questions: \`${ctx.planPath}/03_plan_questions.md\`
${stepOffset + 2}. Read any project context files listed above
${stepOffset + 3}. Generate a detailed implementation plan
${stepOffset + 4}. Generate an execution playbook
${roundContext}
## Output — TWO files

### File 1: \`${ctx.planPath}/03_plan.md\`

A detailed implementation plan. Structure it with:
- Implementation strategy (build order rationale)
- Milestone overview table (milestone, name, key output, dependencies)
- Detailed milestone sections, each containing:
  - Goal
  - Numbered task list with specifics (file paths, function signatures, data structures)
  - Test requirements for that milestone
- Dependency graph (which milestones depend on which)
- Test strategy

Each milestone must be self-contained and testable. Sequential execution — one milestone at a time, committed individually, running continuously without pausing between milestones.

### File 2: \`${ctx.planPath}/04_execute.md\`

An execution playbook. Structure it with:
- Execution order
- Step-by-step protocol (how to run each milestone)
- Rules (one at a time, always commit, etc.)
- Execution status table: | Milestone | Name | Status | Commit | Notes |
  - All milestones start as \`pending\`
  - Status values: \`pending\` | \`in_progress\` | \`done\` | \`blocked\`
- Milestone summary table
- Stack/technology reference

**IMPORTANT:** End the file with a completion checkbox section:

\`\`\`
# Complete

- [ ] Ready to advance to Execution
\`\`\`

The human will tick this checkbox when they have reviewed the plan and are ready for automated execution.

## Code reuse and quality

Before planning ANY new code, you MUST:

1. **Audit the existing codebase thoroughly.** Read every relevant module. Map all existing utilities, helpers, abstractions, patterns, and conventions already in use.
2. **Reuse first, write second.** If existing code already does 80% of what's needed, extend or adapt it — do NOT write a parallel implementation. If an existing function can be generalized with a small change, do that instead of creating a new one.
3. **Follow established patterns.** Match the naming conventions, error handling style, module structure, and abstraction level already present in the codebase. New code should look like it was written by the same author as existing code.
4. **Consolidate, don't accumulate.** If a milestone introduces logic similar to something that already exists, the task list must include refactoring both the old and new code into a shared abstraction. Never leave two functions that do nearly the same thing.
5. **Delete what you replace.** If new code supersedes old code, remove the old code entirely. No dead code, no backwards-compatibility shims, no "kept for reference" comments.

For each milestone, explicitly list:
- Which existing files/functions/patterns will be reused
- Which existing code will be extended or generalized
- What (if anything) is genuinely new with no existing equivalent

## Follow-up handling

If the answers are filled in but insufficient for producing a quality implementation plan,
do NOT produce the plan. Instead, append a \`${followUpSectionHeading(nextRound, MAX_QUESTION_ROUNDS)}\` section to
\`${ctx.planPath}/03_plan_questions.md\` with additional questions using the same format
(including pre-filled recommended answers). Also uncheck the completion checkbox at the bottom
(change \`- [x]\` to \`- [ ]\`). This signals that more information is needed.

## Rules

- Milestones should be small enough to complete in a single session
- Every milestone must end with a passing build and tests
- Include specific file paths, function names, and type signatures in task lists
- The execution playbook must be the single source of truth for progress
`.trim();

  return { prompt, persona: PERSONAS.softwareEngineer };
}

export function forcedSpecPrompt(
  ctx: TaskContext,
  specDescription: string,
  persona: string,
): { prompt: string; persona: string } {
  const prompt = `
You have exhausted all ${MAX_QUESTION_ROUNDS} follow-up rounds for task #${ctx.taskNumber}: "${ctx.title}".

Produce the ${specDescription} now using all available answers. Read all prior question files and answers in \`${ctx.planPath}/\`.

If information is missing, document it as assumptions in a \`## Assumptions & Gaps\` section of the spec. Do not request further questions.
`.trim();

  return { prompt, persona };
}

export function executeMilestonePrompt(ctx: TaskContext): {
  prompt: string;
  persona: string;
} {
  const specInstructions = ctx.trivial === true
    ? ""
    : `Read the product spec: \`${ctx.planPath}/01_product.md\`
Read the design spec: \`${ctx.planPath}/02_design.md\`
`;
  const prompt = `
You are executing a milestone for task #${ctx.taskNumber}: "${ctx.title}".
${contextFilesInstruction(ctx)}
## Your task

1. Read the execution playbook: \`${ctx.planPath}/04_execute.md\`
2. Find the FIRST \`pending\` milestone in the Execution Status table
3. Read the detailed milestone tasks from: \`${ctx.planPath}/03_plan.md\`
4. Read any project context files listed above
${specInstructions}5. Implement ALL tasks for that ONE milestone

## Execution protocol

1. Update the milestone status to \`in_progress\` in \`${ctx.planPath}/04_execute.md\`
2. Implement each task in the milestone
3. Verify the build passes: \`npm run build\` with no errors
4. Run linter: \`npm run lint\` and fix any violations
5. Run tests: \`npm run test\`
6. Fix any failing tests or build errors
7. Update the milestone status to \`done\` in \`${ctx.planPath}/04_execute.md\`

## Rules

- Execute ONLY the first pending milestone — do NOT touch any other milestones
- Implement EXACTLY what the plan specifies — no more, no less
- Do NOT refactor code outside the current milestone's scope
- All code must build, pass lint, and pass tests before marking done
- Write tests as specified in the milestone
- If something in the plan doesn't work, adapt the implementation but keep the same goals
`.trim();

  return { prompt, persona: PERSONAS.softwareEngineer };
}

const CHAT_PERSONA_MAP: Record<string, string> = {
  need_objective: PERSONAS.productDesigner,
  need_product: PERSONAS.productDesigner,
  need_design: PERSONAS.uxDataArchitect,
  need_plan: PERSONAS.softwareEngineer,
  need_execution: PERSONAS.softwareEngineer,
  fine_tuning: PERSONAS.softwareEngineer,
};

const CHAT_ROLE_DESCRIPTIONS: Record<string, string> = {
  need_objective:
    "Help the human think through their objective and answers. Discuss trade-offs, suggest alternatives, draft edits to the questions file.",
  need_product:
    "Help the human think through their objective and answers. Discuss trade-offs, suggest alternatives, draft edits to the questions file.",
  need_design:
    "Help the human think through architecture and planning answers. Explain technical trade-offs, suggest approaches, draft edits to the questions file.",
  need_plan:
    "Help the human think through architecture and planning answers. Explain technical trade-offs, suggest approaches, draft edits to the questions file.",
  need_execution:
    "Help the human review the implementation plan and execution playbook. Discuss milestone ordering, risks, and readiness.",
  fine_tuning:
    "Help the human make small adjustments to the codebase after milestone execution. Bug fixes, display tweaks, minor adjustments. Do not refactor large sections or add new features.",
};

export function chatPrompt(
  ctx: TaskContext,
  stage: Stage,
): { systemPrompt: string; initialMessage: string } {
  const persona = CHAT_PERSONA_MAP[stage] ?? PERSONAS.softwareEngineer;
  const roleDescription =
    CHAT_ROLE_DESCRIPTIONS[stage] ?? CHAT_ROLE_DESCRIPTIONS.need_execution;

  const guardrail1 =
    stage === "fine_tuning"
      ? "You may make small coding changes (bug fixes, display tweaks, minor adjustments) but do not refactor large sections or add new features."
      : "You are helping the human think through their review — do not produce full pipeline artifacts (specs, plans, execution playbooks, etc.).";

  const systemPrompt = `${persona}

You are helping a human review task #${ctx.taskNumber}: "${ctx.title}" at the [${stage}] stage.

## Your role
${roleDescription}

## Guardrails
- ${guardrail1}
- Do not tick completion checkboxes or modify \`state.yml\`.`;

  const contextFilesList = ctx.contextFiles.map((f) => `\`${f}\``).join(", ");

  const initialMessage = `The human wants to discuss task #${ctx.taskNumber}: "${ctx.title}" which is at the [${stage}] stage.
Read the plan documents in \`${ctx.planPath}/\` and the project context files (${contextFilesList}) to understand the current state, then greet the human and ask how you can help.`;

  return { systemPrompt, initialMessage };
}

export function donePrompt(ctx: TaskContext): {
  prompt: string;
  persona: string;
} {
  const specFiles = ctx.trivial === true
    ? ""
    : `   - \`${ctx.planPath}/01_product.md\`
   - \`${ctx.planPath}/02_design.md\`
`;
  const prompt = `
You are finalizing task #${ctx.taskNumber}: "${ctx.title}".
${contextFilesInstruction(ctx)}
## Your task

1. Read the project context files listed above
2. Read the plan and execution playbook:
${specFiles}   - \`${ctx.planPath}/03_plan.md\`
   - \`${ctx.planPath}/04_execute.md\`
3. Verify all milestones are marked \`done\`
4. Run final checks and update documentation

## Steps

1. Run \`npm run build\` — fix any errors
2. Run \`npm run test\` — fix any failures
3. Run \`npm run lint\` — fix any issues
4. Update docs following the documentation standard:
   - README.md is external-facing: install, usage, commands. No internal architecture or implementation details.
   - CLAUDE.md is internal-facing: project structure, key decisions, dev commands. No user-facing install/quickstart.
   - No content should be duplicated at the same level of detail across files.
   - If content is in the wrong file, move it to the correct one and delete the original.
5. Verify the codebase is clean and complete

## Rules

- Do NOT add new features or refactor beyond what's needed
- Focus on making sure everything works and docs are accurate
- If tests or build fail, fix the issues
`.trim();

  return { prompt, persona: PERSONAS.softwareEngineer };
}
