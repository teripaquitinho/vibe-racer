import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { TaskContext } from "../pipeline/types.js";
import type { Stage } from "../state/schema.js";
import { EXECUTION_TABLE_SPEC } from "../pipeline/execute-table.js";
import { PAUSE_BLOCK_SPEC } from "../pipeline/operator-block.js";

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

  qaEngineer: [
    "You are a **Senior QA Engineer**.",
    "Your job performance is measured by the real issues you find, not by confirming that the build passes.",
    "You value evidence over assertion — every claim must be backed by a command you ran and its output.",
    "You judge; you never fix. When you find an issue, you describe it precisely and move on.",
    "A QA report that finds nothing wrong is a red flag, not a success.",
  ].join(" "),

  releaseManager: [
    "You are a **Release Manager** who decides whether work is safe to call delivered.",
    "You think in terms of post-deploy verification, blast radius, and rollback.",
    "Every checklist item you write must be concretely checkable: what to look at, where, and what 'good' looks like.",
    "You trace every item to its source — the objective, an acceptance criterion, or a QA risk.",
    "You do not rubber-stamp; you ensure the operator has everything they need to verify the work after deploy.",
  ].join(" "),
} as const;

export function buildSkillsSection(skills: SlashCommand[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- **${s.name}**: ${s.description ?? "No description"}`);
  return [
    "",
    "## Available Engineering Skills",
    "",
    "You have access to the following engineering skills via the `Skill` tool:",
    "",
    ...lines,
    "",
    "Use these skills when they are relevant to your work in this lap.",
  ].join("\n");
}

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

Write \`${ctx.planPath}/03_plan_questions.md\` (plan questions) directly instead of \`01_product_questions.md\` (product questions). Do NOT write or modify \`state.yml\`.

The file must start with:
\`\`\`
# Plan Questions for #${ctx.taskNumber}: ${ctx.title}

> **Role**: Senior Software Engineer
> **Stage**: \`ai_objective_review\` → \`need_plan\` (trivial fast-path)
> **Date**: ${new Date().toISOString().split("T")[0]}

---
\`\`\`
Then generate plan questions using the same Q&A format described above, ending with the completion checkbox: \`- [ ] Ready to advance to Plan Review\`

Do NOT write \`01_product_questions.md\`.

### If not trivial:

Proceed normally — write \`${ctx.planPath}/01_product_questions.md\` as described above.

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

Each milestone must be self-contained and testable. Sequential execution — one milestone at a time, committed individually, running continuously between operator gates.

### Operator gates in \`03_plan.md\`

An action vibe-racer must not or cannot take, **that a later milestone in this plan depends on**, is an operator gate: merging a prerequisite PR, code review, credentials or secrets, an external service or dashboard, a manual visual or screenshot check, a soak or wait period, running a workflow, anything outside the repository that a following milestone needs. Each gate gets its own section in the plan, in the shape the pipeline reads:

- the heading \`## G<n> — <name>\` — gates are numbered \`G1\`, \`G2\`, … independently of milestones
- a \`- [ ]\` checklist of concrete actions for the operator, one per line at column 0
- a \`**Verification:**\` line: the read-only check the next agent milestone runs to confirm the gate cleared (\`git merge-base --is-ancestor\`, \`gh pr view\`, …). Gates with nothing checkable carry \`**Verification:** None — operator's word\`

What happens *after* the last milestone is not in this plan at all. Merging this task's own PR, tagging, cutting a release, deploying, publishing, announcing — none of them is a milestone, a gate or a checklist item. The execute lap ends at the last agent milestone and the task goes to QA; the merge is the operator's, after QA and cleanup, and QA needs the branch unmerged to have something to review. If you must mention such steps, do it in a closing note — never as rows.

### File 2: \`${ctx.planPath}/04_execute.md\`

An execution playbook. Structure it with:
- Execution order
- Step-by-step protocol (how to run each milestone)
- Rules (one at a time, always commit, etc.)
- The milestone status table, in exactly the shape specified below. Every milestone starts as \`pending\`. Every gate is its own row with \`Owner\` = \`operator\` — never prose between rows — and **every gate row is followed by the agent milestone it unblocks**. Merge, tag, release and deploy of this task's own work are not rows: they come after QA.
- Milestone summary table
- Stack/technology reference
- An "Operator gates" section, **immediately above the \`# Complete\` checkbox** (see below)

${EXECUTION_TABLE_SPEC}

Table rules for this plan, in addition to the above:

- A step vibe-racer must not or cannot take that a later milestone depends on (the categories listed under "Operator gates" above) is its own row with \`Owner\` = \`operator\` and ID \`G<n>\`, matching its \`## G<n> — <name>\` section in \`03_plan.md\`. Never write such a step as prose between rows or inside a Notes cell.
- **Every gate row must have at least one agent milestone after it.** A gate with nothing after it is a post-execution step, not a gate: it belongs in the plan's closing notes, not in the table. Merging this task's PR, tagging, releasing and deploying are never rows — they happen after the QA lap.

### The "Operator gates" section in \`04_execute.md\`

Directly above the \`# Complete\` checkbox, write:

\`\`\`
## Operator gates in this plan

Execution will pause at each of these and wait for you.

- **G1** — <what the operator does> — before M<n>
\`\`\`

If the plan has no gates, the section is still written and reads exactly:
\`None — execution runs start to finish without you.\`
An explicit "none" is a promise the operator can hold the plan to.

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

export interface MilestoneRef {
  /** The Execution Status row ID the loop chose — `M3`, `M5a`. */
  id: string;
  /** The row's Name cell; may be empty when the table has no Name column. */
  name: string;
}

export function executeMilestonePrompt(
  ctx: TaskContext,
  milestone: MilestoneRef,
): {
  prompt: string;
  persona: string;
} {
  const specInstructions = ctx.trivial === true
    ? ""
    : `Read the product spec: \`${ctx.planPath}/01_product.md\`
Read the design spec: \`${ctx.planPath}/02_design.md\`
`;
  const label = milestone.name ? `${milestone.id} — ${milestone.name}` : milestone.id;
  const prompt = `
You are executing a milestone for task #${ctx.taskNumber}: "${ctx.title}".
${contextFilesInstruction(ctx)}
## Your task

1. Read the execution playbook: \`${ctx.planPath}/04_execute.md\`
2. The milestone to execute is **${label}** — the milestone named in this prompt. The pipeline chose it from the Execution Status table; do not pick a different row
3. Read the detailed milestone tasks from: \`${ctx.planPath}/03_plan.md\`
4. Read any project context files listed above
${specInstructions}5. Implement ALL tasks for that ONE milestone

## Execution protocol

1. If this milestone follows an operator gate, verify the gate cleared first — see "Gate verification" below
2. Update the milestone status to \`in_progress\` in \`${ctx.planPath}/04_execute.md\`
3. Implement each task in the milestone
4. Verify the build passes: \`npm run build\` with no errors
5. Run linter: \`npm run lint\` and fix any violations
6. Run tests: \`npm run test\`
7. Fix any failing tests or build errors
8. Update the milestone status to \`done\` in \`${ctx.planPath}/04_execute.md\`

${EXECUTION_TABLE_SPEC}

## When you cannot finish: the \`needs_operator\` protocol

If this milestone — or anything it depends on — needs an action you must not or cannot take, do **not** attempt it, do **not** work around it, and do **not** start a later milestone. Instead:

1. Set this milestone's status to \`needs_operator\` in the Execution Status table
2. Append an Operator actions block to the end of \`${ctx.planPath}/04_execute.md\`, in exactly the format below
3. End the session with a final message that says what you need and why

${PAUSE_BLOCK_SPEC}

## What you never do

- **You never push, open PRs, merge PRs or deploy.** Not for this task, not for a prerequisite, not to "help". Those are the operator's, and a milestone that needs one of them is a \`needs_operator\` stop.
- **Execution ends at the last agent milestone.** Merging this task's PR, tagging and deploying happen after the QA lap and are not yours. If the table still carries such a row from an older plan, leave it exactly as it is — do not run it, do not mark it, do not \`needs_operator\` it. The handler ends the lap.

## Gate verification

Before a milestone that depends on an operator gate (a row with \`Owner\` = \`operator\` before it in the table), confirm the gate actually cleared:

1. Run the read-only check from the gate's \`**Verification:**\` line in \`${ctx.planPath}/03_plan.md\` — \`git fetch\`, \`git log\`, \`git merge-base\`, \`gh pr view\` and the like. Read-only only.
2. If the check cannot run (no network, no \`gh\`), fall back to local refs: \`git log\`, \`git branch --contains\`, \`git merge-base\` against what is already fetched.
3. If that is inconclusive, **take the operator's tick as the answer** and say so in your session output. A gate the operator ticked is not a failed gate because you could not check it.

Only a check that ran and showed the gate unmet is a reason to stop; then follow the \`needs_operator\` protocol and quote the check's output in the block.

## Rules

- Execute ONLY the milestone named above — do NOT touch any other milestones
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
  need_operator: PERSONAS.softwareEngineer,
  fine_tuning: PERSONAS.qaEngineer,
  need_decision: PERSONAS.releaseManager,
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
  need_operator:
    "The task is paused waiting on you. Read the last 'Operator actions' block in 04_execute.md. " +
    "Explain what the gate needs and why, help reword or split the milestone, and help edit the " +
    "Execution Status table if the step is not one vibe-racer can take.",
  fine_tuning:
    "I've reviewed the QA findings in 05_qa.md. I can help you understand the issues found, prioritize which findings to address, and guide fixes. I have full context of the plan directory.",
  need_decision:
    "I've read the post-deploy checklist in 06_decision.md. I can help you work through each item, explain what to verify and how, and advise on whether an item can be waived. I have full context of the plan directory.",
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

  // Nothing but this prompt enforces it: `radio` spawns the operator's own interactive `claude`
  // CLI, where `canUseTool` and Rule 0 do not run. True of radio at every stage, not new here.
  const pauseGuardrail =
    stage === "need_operator"
      ? "\n- Do not push, open PRs, merge or deploy, and do not tick the resume marker — that is the operator's."
      : "";

  const systemPrompt = `${persona}

You are helping a human review task #${ctx.taskNumber}: "${ctx.title}" at the [${stage}] stage.

## Your role
${roleDescription}

## Guardrails
- ${guardrail1}
- Do not tick completion checkboxes or modify \`state.yml\`.${pauseGuardrail}`;

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

export function decisionPrompt(ctx: TaskContext): {
  prompt: string;
  persona: string;
} {
  const prompt = `
You are a Release Manager preparing the post-deploy checklist for task #${ctx.taskNumber}: "${ctx.title}".

## Context

Read these files for full context:
- \`${ctx.planPath}/00_objective.md\` — original intent
- \`${ctx.planPath}/03_plan.md\` — acceptance criteria and implementation plan
- \`${ctx.planPath}/05_qa.md\` — QA findings, risks, known limitations

## Instructions

Write \`${ctx.planPath}/06_decision.md\` with a checklist of everything that must be verified
AFTER DEPLOY before this task can be considered delivered.

Every item must be:
- Concretely checkable: what to look at, where, and what "good" looks like
- Traced to a source: the objective, an acceptance criterion, or a QA risk

Use markdown checkboxes. Prefer flat, top-level \`- [ ]\` items; avoid nesting.

Do NOT include boilerplate items. Every item must be specific to this task.

If the plan documents accepted residual risks, each must appear as a named item
in the checklist so the operator signs off on them knowingly.

Do NOT add a "# Complete" section or a "Ready to advance" checkbox — the pipeline appends it.
`.trim();

  return { prompt, persona: PERSONAS.releaseManager };
}

/**
 * `gates` is every operator-owned row the task's playbook carries, as `G<n> — <name>`. The QA
 * lap reviews `git diff main...HEAD`, so anything the operator merged at a gate is invisible to
 * it; when there were gates the report has to say so before it says anything else.
 */
export function qaPrompt(ctx: TaskContext, gates: string[]): {
  prompt: string;
  persona: string;
} {
  const gatesSection = gates.length === 0
    ? ""
    : `
## Operator gates this task paused at

Execution paused at ${gates.length} operator gate(s) and resumed after the operator's work:
${gates.map((g) => `- ${g}`).join("\n")}

Work the operator did at a gate — merging other PRs, changing infrastructure, rotating
credentials — may already be in \`main\`, and \`git diff main...HEAD\` does not show it. Your
report MUST open with its coverage, before any section, in this shape:

> This task paused at G1 (PRs merged into main). Work merged before that gate is outside
> \`git diff main...HEAD\` and was not reviewed here.

Name every gate listed above. Do not skip this even if you believe the gate changed nothing.
`;
  const prompt = `
You are a Senior QA Engineer reviewing task #${ctx.taskNumber}: "${ctx.title}".

YOUR JOB IS TO FIND PROBLEMS. A QA report that finds nothing wrong is a red
flag, not a success — it means you didn't look hard enough or you're being
agreeable. The team depends on you to catch what the engineer missed.

## What changed
Before you assess anything, establish what this task actually changed:
  git diff --stat main...HEAD
  git log --oneline main..HEAD
Read the diff. Your review is scoped to these changes plus anything they could break.
Do not review code this task did not touch, except to check for regressions.

If that diff is empty or the command fails (no main branch, shallow clone, detached
HEAD), do NOT stop and do NOT report the work as clean. Fall back to reviewing every
file named in 03_plan.md's milestone tasks, and say in "Verification run" which scope
you used and why.
${gatesSection}
## Where you sit in the pipeline
You run immediately after the last execution milestone and BEFORE the cleanup lap.
Cleanup has not happened yet. Cleanup is the lap that updates project documentation —
README, CLAUDE.md, CHANGELOG, the docs site — to reflect this change.

So do NOT report stale or missing project documentation as a gap. It is not late, it is
scheduled, and the operator reads this report to decide whether the CODE is right. A report
padded with doc-freshness items buries the findings that matter.

One exception: documentation the plan itself made a deliverable — an acceptance criterion,
or a task inside a milestone. That is execution scope, and an unmet one is a real finding.
When you report one, name the criterion or milestone it comes from, so the reader can tell
it apart from cleanup's work.

Your subject is the code: does it do what the plan says, does it hold up under the edge
cases the plan named, what did it break, what did the engineer quietly skip. Comments and
docstrings inside changed code are code — judge them.

## Context

Read these files for full context:
- \`${ctx.planPath}/00_objective.md\` — original intent
- \`${ctx.planPath}/03_plan.md\` — acceptance criteria and implementation plan
- \`${ctx.planPath}/04_execute.md\` — what was claimed done

## Required Sections in 05_qa.md
You MUST produce ALL of the following sections. No section may be omitted.

1. **What works** — Verified against acceptance criteria. For each criterion:
   run the verification command, paste its output, state pass/fail.
2. **What doesn't** — Gaps between plan and implementation. Code first; a documentation
   item belongs here only when the plan made it a deliverable (see above). If empty, write:
   "No issues found — verified by [specific evidence]"
3. **What regressed** — Run the full test suite. Compare against expectations.
   If empty, write: "No regressions found — [test command] output: [paste]"
4. **Deviations** — Where execution departed from plan. Was each sound?
5. **Risks and known limitations** — Will feed into the decision checklist.
6. **Verification run** — Run: build, lint, tests. Paste full output.
   Do NOT summarize. Do NOT say "all tests pass" — paste the output.

## Rules
- Every claim (positive or negative) MUST include the command run and output.
- Do NOT fix any issues you find. You are judging, not fixing.
- Do NOT write files outside the plan directory.
- Do NOT add a "# Complete" section or a "Ready to advance" checkbox — the pipeline appends it.
- Write your report to \`${ctx.planPath}/05_qa.md\`.
`.trim();

  return { prompt, persona: PERSONAS.qaEngineer };
}
