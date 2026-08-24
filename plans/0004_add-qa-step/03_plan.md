# Implementation Plan: Add QA Step (#4)

> **Stage**: `ai_plan_review`
> **Date**: 2026-08-24

---

## Implementation Strategy

Build order is driven by **risk and dependency**, not by workstream label. The three workstreams (A: state.yml protection, B: skills, C: QA + decision) share overlapping files, so they are interleaved by layer:

1. **Schema first** — everything depends on the stage enum.
2. **Trivial re-plumb before guard** — the current trivial path has the agent write `state.yml`. Rule 0 would silently break it. Re-plumbing first keeps every intermediate commit honest.
3. **Guard + error recovery** — highest-risk changes to security enforcement. Ships early but after the trivial dependency is removed.
4. **Skills** — independent module, but prompts need it wired before QA/decision prompts can reference skills.
5. **QA + decision** — the two new stages, wired end to end. Depends on milestones 1-4.
6. **Docs + cleanup** — final pass, deletes `vibe-racer-fix.md`.

---

## Milestone Overview

| # | Name | Key Output | Dependencies |
|---|---|---|---|
| 1 | Schema + State Machine | 16-stage enum, updated stage maps, regression tests | None |
| 2 | Trivial Fast-Path Re-Plumb | Agent signals triviality via file artifact, handler sets `trivial: true` | M1 |
| 3 | Guard Hardening + Error Recovery | Rule 0, split review stages, `setError` hardening, validate-on-write, `--retry` fix | M1, M2 |
| 4 | Skills Module | `skills.ts`, session changes, config extension, prompt builder | M1 |
| 5 | QA Handler + Decision Extension | `handleQa`, `handleDone` extension, checklist enforcement, radio personas, pitwall, drive hints | M1-M4 |
| 6 | Docs + Cleanup | Updated README, CLAUDE.md, pipeline docs, CHANGELOG. Delete `vibe-racer-fix.md` | M1-M5 |

---

## Milestone 1: Schema + State Machine

### Goal

Extend the stage enum from 14 to 16 entries, update all stage maps and helpers, and confirm the existing test suite passes with the new stage order.

### Existing code reused

- `src/state/schema.ts` — extend `STAGES` array
- `src/pipeline/states.ts` — extend `AGENT_STAGES`, `STAGE_QUESTIONS_FILE`, `STAGE_NEXT_NAME`
- `tests/state/schema.test.ts` — extend with new stage parsing tests

### Tasks

1. **`src/state/schema.ts`** — Insert `"ai_qa"` after `"ready_to_execute"` and `"need_decision"` after `"cleanup_ready"` in the `STAGES` array. The final order (16 entries):
   ```
   need_objective, ai_objective_review, need_product, ai_product_review,
   need_design, ai_design_review, need_plan, ai_plan_review,
   need_execution, ready_to_execute, ai_qa, fine_tuning,
   cleanup_ready, need_decision, done, error
   ```

2. **`src/pipeline/states.ts`** — Update stage collections:
   - `AGENT_STAGES`: add `"ai_qa"` to the Set
   - `STAGE_QUESTIONS_FILE`: change `fine_tuning` mapping from `"04_execute.md"` to `"05_qa.md"`, add `need_decision: "06_decision.md"`
   - `STAGE_NEXT_NAME`: add `need_decision: "Done"` (keep `fine_tuning: "Cleanup"` unchanged)

3. **`tests/state/schema.test.ts`** — Add tests:
   - All 16 stages parse via `stateSchema.parse()`
   - `STAGES.length === 16`

4. **`tests/pipeline/states.test.ts`** (new file) — Stage order regression tests:
   - `nextStage("need_plan") === "ai_plan_review"` (existing regression guard from `vibe-racer-fix.md`)
   - `nextStage("ready_to_execute") === "ai_qa"`
   - `nextStage("ai_qa") === "fine_tuning"`
   - `nextStage("cleanup_ready") === "need_decision"`
   - `nextStage("need_decision") === "done"`
   - `isAgentStage("ai_qa") === true`
   - `isHumanStage("need_decision") === true`

### Test requirements

- All existing tests pass (`npm run test`)
- New stage order tests pass
- `npm run typecheck` passes (Stage union type now includes new values)
- `npm run build` passes

---

## Milestone 2: Trivial Fast-Path Re-Plumb

### Goal

Move the `trivial: true` write from the agent to the handler. After this milestone, the objective-review agent never writes `state.yml` — it signals triviality by writing `03_plan_questions.md` instead of `01_product_questions.md`, and the handler reads that artifact.

### Existing code reused

- `src/claude/prompts.ts` — modify `objectiveReviewPrompt()` (line ~78)
- `src/pipeline/handlers/objective-review.ts` — modify trivial detection (line ~24-31)
- `tests/pipeline/handlers/objective-review.test.ts` — extend

### Tasks

1. **`src/claude/prompts.ts`** — In `objectiveReviewPrompt()`, replace the "If trivial" instructions that tell the agent to set `trivial: true` in `state.yml`. New instruction:
   - "If this is a trivial task, write `03_plan_questions.md` (plan questions) directly instead of `01_product_questions.md` (product questions). Do NOT write or modify `state.yml`."
   - Remove any instruction referencing writing to `state.yml`.

2. **`src/pipeline/handlers/objective-review.ts`** — Replace the trivial detection logic. Current code reads `state.trivial` from `readState()`. New logic after the session completes:
   ```typescript
   const planQuestionsPath = path.join(ctx.cwd, ctx.planPath, "03_plan_questions.md");
   const productQuestionsPath = path.join(ctx.cwd, ctx.planPath, "01_product_questions.md");

   if (existsSync(planQuestionsPath) && !existsSync(productQuestionsPath)) {
     // Agent signaled triviality by writing plan questions directly
     const state = readState(path.resolve(ctx.cwd, ctx.planPath));
     writeState(path.resolve(ctx.cwd, ctx.planPath), { ...state, trivial: true });
     updateStage(ctx.planPath, "need_plan");
   } else {
     updateStage(ctx.planPath, "need_product");
   }
   ```
   Import `existsSync` from `node:fs` and `writeState` from `../../state/store.js`.
   Note: `writeState` is currently not exported. Export it from `store.ts`.

3. **`src/state/store.ts`** — Export `writeState` (currently private). Change from `function writeState(...)` to `export function writeState(...)`.

4. **`tests/pipeline/handlers/objective-review.test.ts`** — Update tests:
   - Mock `existsSync` to simulate the file-presence signal
   - Test: when `03_plan_questions.md` exists and `01_product_questions.md` does not, handler sets `trivial: true` and advances to `need_plan`
   - Test: when `01_product_questions.md` exists, handler advances to `need_product` (normal flow)
   - Remove any test that expects the agent to have written `trivial: true` to `state.yml`

### Test requirements

- Existing tests pass (after updating objective-review tests)
- Trivial fast-path tests verify file-presence detection
- Build and typecheck pass

---

## Milestone 3: Guard Hardening + Error Recovery

### Goal

Close the `state.yml` corruption hole (Rule 0), split `REVIEW_STAGES` into `PLAN_JAILED_STAGES` + `BASH_BLOCKED_STAGES`, harden `setError`, add validate-on-write, fix `--retry`, and update `withErrorHandling` to pass stages instead of handler names.

### Existing code reused

- `src/claude/guard.ts` — modify `REVIEW_STAGES`, `canUseTool`, `formatGuardSummary`, add `plansDir` to `GuardOptions`
- `src/state/store.ts` — modify `setError`, `writeState`
- `src/pipeline/handlers/safe-wrapper.ts` — modify `withErrorHandling` signature
- `src/pipeline/machine.ts` — update handler registrations
- `src/cli/drive.ts` — fix `--retry` logic
- `tests/claude/guard.test.ts` — extend
- `tests/state/store.test.ts` (new or extend existing) — `setError` hardening tests

### Tasks

1. **`src/claude/guard.ts`** — Add `plansDir` to `GuardOptions`:
   ```typescript
   interface GuardOptions {
     cwd: string;
     stage: Stage;
     taskPlanPath: string;
     plansDir: string;
   }
   ```

2. **`src/claude/guard.ts`** — Replace `REVIEW_STAGES` with two sets:
   ```typescript
   const PLAN_JAILED_STAGES = new Set<Stage>([
     "ai_objective_review", "ai_product_review",
     "ai_design_review", "ai_plan_review", "ai_qa",
   ]);

   const BASH_BLOCKED_STAGES = new Set<Stage>([
     "ai_objective_review", "ai_product_review",
     "ai_design_review", "ai_plan_review",
   ]);
   ```

3. **`src/claude/guard.ts`** — Insert Rule 0 in `createToolGuard`, before the existing Rule 1 (sensitive path check). After path resolution, before any other rule:
   ```typescript
   // Rule 0: Deny agent writes to state.yml under plans_dir
   if (toolName === "Write" || toolName === "Edit") {
     const plansRoot = path.resolve(options.cwd, options.plansDir);
     if (path.basename(resolved) === "state.yml" && resolved.startsWith(plansRoot)) {
       return deny(toolName, rawPath, "state.yml is owned by the pipeline");
     }
   }
   ```

4. **`src/claude/guard.ts`** — Update Rule 4 to use new sets:
   - Rule 4a: `if (PLAN_JAILED_STAGES.has(options.stage) && (toolName === "Write" || toolName === "Edit"))` — jail to `taskPlanPath`
   - Rule 4b: `if (BASH_BLOCKED_STAGES.has(options.stage) && toolName === "Bash")` — deny with audit

5. **`src/claude/guard.ts`** — Add explicit `Skill` allow:
   ```typescript
   if (toolName === "Skill") return { behavior: "allow" as const };
   ```

6. **`src/claude/guard.ts`** — Update `formatGuardSummary` to use `PLAN_JAILED_STAGES` and `BASH_BLOCKED_STAGES`:
   ```typescript
   export function formatGuardSummary(stage: Stage, allowedTools: string[]): string {
     const jailed = PLAN_JAILED_STAGES.has(stage);
     const bashBlocked = BASH_BLOCKED_STAGES.has(stage);
     const pathNote = jailed ? "path-jail to ./<plan>" : "path-jail to ./";
     const bashNote = bashBlocked ? "bash: blocked (review stage)" : `bash: ${BASH_BLOCKLIST.length} commands blocked`;
     return `Guard: ${pathNote}  ·  tools: [${allowedTools.join(", ")}]  ·  ${bashNote}`;
   }
   ```

7. **`src/claude/session.ts`** — Pass `plansDir` to `createToolGuard`. Derive from `options.taskPlanPath`:
   ```typescript
   const plansDir = path.dirname(options.taskPlanPath ?? "");
   createToolGuard({ cwd, stage, taskPlanPath: options.taskPlanPath ?? "", plansDir });
   ```

8. **`src/state/store.ts`** — Harden `setError`:
   ```typescript
   export function setError(planPath: string, errorStage: string, message: string): void {
     let salvaged: Partial<TaskState> = {};
     try {
       salvaged = readState(planPath);
     } catch {
       try {
         const raw = readFileSync(path.join(planPath, STATE_FILE), "utf-8");
         const parsed = parse(raw);
         if (typeof parsed?.title === "string") salvaged.title = parsed.title;
         if (typeof parsed?.created === "string") salvaged.created = parsed.created;
         if (typeof parsed?.trivial === "boolean") salvaged.trivial = parsed.trivial;
       } catch {
         // Give up salvaging
       }
     }
     writeState(planPath, {
       ...salvaged,
       stage: "error",
       title: salvaged.title ?? path.basename(planPath),
       error_stage: errorStage,
       error_message: message,
     } as TaskState);
   }
   ```

9. **`src/state/store.ts`** — Add validate-on-write to `writeState`. After computing `prev`/`next`/`updated`, validate:
   ```typescript
   const updated = { ...state, prev, next, updated: new Date().toISOString() };
   stateSchema.parse(updated);  // throws on invalid state
   writeFileSync(filePath, stringify(updated), "utf-8");
   ```

10. **`src/pipeline/handlers/safe-wrapper.ts`** — Change `withErrorHandling` to accept a `Stage` instead of a handler name string:
    ```typescript
    import type { Stage } from "../../state/schema.js";

    export function withErrorHandling(
      stage: Stage,
      handler: (ctx: TaskContext) => Promise<void>,
    ): (ctx: TaskContext) => Promise<void>
    ```
    The `stage` is what gets passed to `setError` as `errorStage`.

11. **`src/pipeline/machine.ts`** — Update all handler registrations to pass stages:
    ```typescript
    "ai_objective_review": withErrorHandling("ai_objective_review", handleObjectiveReview),
    "ai_product_review":   withErrorHandling("ai_product_review", handleProductReview),
    "ai_design_review":    withErrorHandling("ai_design_review", handleDesignReview),
    "ai_plan_review":      withErrorHandling("ai_plan_review", handlePlanReview),
    "ready_to_execute":    withErrorHandling("ready_to_execute", handleExecute),
    "cleanup_ready":       withErrorHandling("cleanup_ready", handleDone),
    ```

12. **`src/cli/drive.ts`** — Fix `--retry` logic. After selecting a task in `error` state:
    ```typescript
    if (state.stage === "error") {
      const errorStage = state.error_stage;
      if (errorStage && STAGES.includes(errorStage as Stage)) {
        updateStage(planPath, errorStage as Stage);
        await dispatch(errorStage, ctx);
      } else {
        log.error(`Task #${taskNumber} failed at '${errorStage ?? "unknown"}' (unrecognized stage).`);
        log.error(`Set 'stage:' in ${planPath}/state.yml manually and re-run 'drive'.`);
        return;
      }
    }
    ```
    Import `STAGES` from `../state/schema.js`.

13. **`tests/claude/guard.test.ts`** — Add tests:
    - Rule 0: `Write` to `<planPath>/state.yml` denied at review stage, execution stage, and QA stage
    - Rule 0: `Write` to `<planPath>/02_design.md` still allowed at review stage
    - Rule 0: `Write` to a `state.yml` outside `plansDir` is allowed (not blocked)
    - Rule 4a: `Write` at `ai_qa` jailed to plan directory
    - Rule 4b: `Bash` denied at `ai_objective_review` (review stage)
    - Rule 4b: `Bash` allowed at `ai_qa`
    - `Skill` tool explicitly allowed
    - Update `makeGuard` helper to include `plansDir`

14. **`tests/state/store.test.ts`** (new file or extend) — Tests:
    - `setError` with valid `state.yml` — writes `stage: "error"` with `error_stage` set to a stage name
    - `setError` with invalid YAML in `state.yml` — writes a valid error record, salvaging `title`/`created`/`trivial`
    - `setError` with missing `state.yml` — writes a valid error record with fallback title
    - `writeState` with invalid state object — throws Zod validation error

15. **`tests/pipeline/safe-wrapper.test.ts`** — Update to pass stage names instead of handler names.

16. **`tests/cli/drive.test.ts`** — Add `--retry` tests:
    - Task in error with valid `error_stage` (a real stage) — restores and dispatches
    - Task in error with legacy handler-name `error_stage` — prints message, does not throw

### Test requirements

- All existing tests pass (with updates for changed signatures)
- Guard tests cover Rule 0, split stages, Skill allow
- Store tests cover `setError` hardening and validate-on-write
- `--retry` tests cover both valid and legacy `error_stage`
- Build, lint, typecheck pass

---

## Milestone 4: Skills Module

### Goal

Create the skills resolution module, wire `Skill` into sessions, extend config schema, and add a prompt builder for skills sections.

### Existing code reused

- `src/claude/session.ts` — modify `settingSources`, add `Skill` to tools, add probe query
- `src/claude/prompts.ts` — add `buildSkillsSection()`
- `src/config/schema.ts` — add `skills` key

### Genuinely new

- `src/claude/skills.ts` — `resolveSkills()`, `partitionSkills()`, `DEFAULT_SKILLS`

### Tasks

1. **`src/claude/skills.ts`** (new file):
   ```typescript
   import type { SlashCommand } from "@anthropic-ai/claude-code";
   import type { VibeRacerConfig } from "../config/schema.js";

   const DEFAULT_SKILLS: Record<string, string[]> = {
     objective: [],
     product: [],
     design: [],
     plan: [],
     execute: [],
     qa: [],
     decision: [],
   };

   export function resolveSkills(lap: string, config: VibeRacerConfig): string[] {
     return config.skills?.[lap] ?? DEFAULT_SKILLS[lap] ?? [];
   }

   export function partitionSkills(
     requested: string[],
     installed: SlashCommand[],
   ): { available: SlashCommand[]; missing: string[] } {
     const installedMap = new Map(installed.map(s => [s.name, s]));
     const available: SlashCommand[] = [];
     const missing: string[] = [];
     for (const name of requested) {
       const skill = installedMap.get(name);
       if (skill) available.push(skill);
       else missing.push(name);
     }
     return { available, missing };
   }
   ```

2. **`src/claude/prompts.ts`** — Add `buildSkillsSection()`:
   ```typescript
   import type { SlashCommand } from "@anthropic-ai/claude-code";

   export function buildSkillsSection(skills: SlashCommand[]): string {
     if (skills.length === 0) return "";
     const lines = skills.map(s => `- **${s.name}**: ${s.description ?? "No description"}`);
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
   ```

3. **`src/config/schema.ts`** — Add `skills` to the config schema:
   ```typescript
   skills: z.record(z.string(), z.array(z.string())).optional(),
   ```
   Do NOT touch `repo` or any other existing field.

4. **`src/claude/session.ts`** — Change `settingSources`:
   ```typescript
   settingSources: ["project", "user"],
   ```

5. **`src/claude/session.ts`** — Add skill resolution and probe query to `runAndStream`. Add a `lap?: string` field to `SessionOptions`. Before building the prompt:
   ```typescript
   let skillsSection = "";
   if (options.lap) {
     const config = loadConfig(options.cwd);
     const requested = resolveSkills(options.lap, config);
     if (requested.length > 0) {
       // Probe query to discover installed skills
       const probe = query({ prompt: "", options: { cwd: options.cwd, settingSources: ["project", "user"], maxTurns: 0 } });
       try {
         const installed = await probe.supportedCommands();
         const { available, missing } = partitionSkills(requested, installed);
         if (missing.length > 0) {
           log.warn(`Skills not found: ${missing.join(", ")}`);
         }
         skillsSection = buildSkillsSection(available);
       } finally {
         await probe.return();
       }
     }
   }
   ```
   If the probe approach doesn't work (returns empty), fall back to the streaming-input approach per the design spec. The spike verifying this is the first task of this milestone.

6. **`src/claude/session.ts`** — When `options.lap` is set and skills are requested, add `"Skill"` to `allowedTools`.

7. **`tests/claude/skills.test.ts`** (new file):
   - `resolveSkills` with config override returns config values
   - `resolveSkills` with no config returns defaults (empty arrays)
   - `resolveSkills` with unknown lap returns empty array
   - `partitionSkills` splits correctly: available includes full SlashCommand objects, missing includes names not found
   - `partitionSkills` with empty inputs returns empty outputs

8. **`tests/claude/session.test.ts`** — Update to verify `settingSources` includes `"user"`.

### Test requirements

- Skills module unit tests pass
- Existing session tests pass with updated `settingSources`
- Config schema accepts `skills` key
- Build, lint, typecheck pass

---

## Milestone 5: QA Handler + Decision Extension

### Goal

Wire the two new stages end to end: `handleQa` writes `05_qa.md`, `handleDone` is extended to write `06_decision.md` and park at `need_decision`, checklist enforcement is added to `tryAdvance`, and supporting changes land in radio personas, pitwall, drive, and execute.

### Existing code reused

- `src/pipeline/handlers/execute.ts` — modify post-loop advancement and checkbox
- `src/pipeline/handlers/done.ts` — extend to write `06_decision.md`
- `src/pipeline/machine.ts` — register `handleQa`
- `src/pipeline/validation.ts` — add `validateDecisionChecklist()`
- `src/state/advancement.ts` — add checklist check for `need_decision`
- `src/claude/prompts.ts` — add `qaPrompt()`, `decisionPrompt()`, update `CHAT_PERSONA_MAP`, `CHAT_ROLE_DESCRIPTIONS`
- `src/cli/drive.ts` — add post-execution hint
- `src/cli/pitwall.ts` — render new stages (already works via `AGENT_STAGES`/`isHumanStage`)

### Genuinely new

- `src/pipeline/handlers/qa.ts` — `handleQa()`

### Tasks

1. **`src/claude/prompts.ts`** — Add `qaPrompt(ctx: TaskContext, skills?: SlashCommand[]): { prompt: string; persona: string }`:
   - Persona: `"Senior QA Engineer"`
   - Adversarial framing as specified in the design spec's QA prompt section
   - Loads `00_objective.md`, `03_plan.md`, `04_execute.md` as context
   - Mandatory sections: What works, What doesn't, What regressed, Deviations, Risks and known limitations, Verification run
   - Rules: evidence-based claims, no fixing, write to `05_qa.md`
   - Appends skills section if provided

2. **`src/claude/prompts.ts`** — Add `decisionPrompt(ctx: TaskContext, skills?: SlashCommand[]): { prompt: string; persona: string }`:
   - Persona: `"Release Manager"`
   - Loads `00_objective.md`, `03_plan.md`, `05_qa.md` as context
   - Instructions: write `06_decision.md` with concretely checkable items traced to sources
   - Appends skills section if provided

3. **`src/claude/prompts.ts`** — Update `CHAT_PERSONA_MAP`:
   - Change `fine_tuning` value from `softwareEngineer` to a new persona key or inline `"Senior QA Engineer"`
   - Add `need_decision: "Release Manager"`

4. **`src/claude/prompts.ts`** — Update `CHAT_ROLE_DESCRIPTIONS`:
   - `fine_tuning`: Update to reference QA findings in `05_qa.md`, help prioritize findings, guide fixes
   - `need_decision`: New entry — help work through post-deploy checklist in `06_decision.md`

5. **`src/pipeline/handlers/qa.ts`** (new file):
   ```typescript
   import { qaPrompt, buildSkillsSection } from "../../claude/prompts.js";
   import { runAndStream } from "../../claude/session.js";
   import { updateStage } from "../../state/store.js";
   import { commitAll } from "../../git/commit.js";
   import { completionSection } from "../validation.js";
   import { resolveSkills, partitionSkills } from "../../claude/skills.js";
   import type { TaskContext } from "../types.js";
   import { existsSync, readFileSync, appendFileSync } from "node:fs";
   import path from "node:path";

   const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write", "Bash"];

   export async function handleQa(ctx: TaskContext): Promise<void> {
     const { prompt, persona } = qaPrompt(ctx);

     await runAndStream({
       prompt,
       persona,
       cwd: ctx.cwd,
       allowedTools: ALLOWED_TOOLS,
       stage: "ai_qa",
       taskPlanPath: ctx.planPath,
       lap: "qa",
     });

     // Verify 05_qa.md was written
     const qaPath = path.join(ctx.cwd, ctx.planPath, "05_qa.md");
     if (!existsSync(qaPath)) {
       throw new Error("QA session did not produce 05_qa.md");
     }

     // Append completion checkbox
     appendFileSync(qaPath, completionSection("Cleanup"), "utf-8");

     updateStage(ctx.planPath, "fine_tuning");

     const git = simpleGit(ctx.cwd);
     await commitAll(git, `vibe-racer: QA review for #${ctx.taskNumber}`, ctx.cwd);

     log.info("Review QA findings in 05_qa.md, then tick the checkbox.");
   }
   ```
   (Exact imports will be adjusted to match existing patterns in the handler files.)

6. **`src/pipeline/handlers/execute.ts`** — Modify post-loop behavior:
   - Change advancement target from `"fine_tuning"` to `"ai_qa"`
   - Change the checkbox replacement: instead of writing `- [ ] Ready to advance to Cleanup` in `04_execute.md`, remove the checkbox-rewriting logic entirely (QA will add its own checkbox to `05_qa.md`)
   - Add hint after commit: `log.info("Task #N is ready for QA -- run 'vibe-racer drive' to start the QA lap.")`

7. **`src/pipeline/handlers/done.ts`** — Extend `handleDone`:
   - After existing docs pass + build/lint/test, build decision prompt
   - Run a second Claude session to write `06_decision.md`
   - Append completion checkbox: `completionSection("Done")`
   - Change advancement from `"done"` to `"need_decision"`
   - Update commit message: `"vibe-racer: cleanup + decision checklist for #N"`

8. **`src/pipeline/machine.ts`** — Register `handleQa`:
   ```typescript
   import { handleQa } from "./handlers/qa.js";
   // ...
   "ai_qa": withErrorHandling("ai_qa", handleQa),
   ```

9. **`src/pipeline/validation.ts`** — Add `validateDecisionChecklist()`:
   ```typescript
   export function validateDecisionChecklist(filePath: string): {
     valid: boolean;
     unchecked: Array<{ line: number; text: string }>;
   } {
     const content = readFileSync(filePath, "utf-8");
     const lines = content.split("\n");
     const unchecked: Array<{ line: number; text: string }> = [];
     for (let i = 0; i < lines.length; i++) {
       if (/^-\s*\[\s\]/.test(lines[i])) {
         unchecked.push({ line: i + 1, text: lines[i].trim() });
       }
     }
     return { valid: unchecked.length === 0, unchecked };
   }
   ```

10. **`src/state/advancement.ts`** — Add checklist enforcement for `need_decision`. After the existing `validateAnswers` check (step 4 in `tryAdvance`), before advancing:
    ```typescript
    if (currentStage === "need_decision") {
      const checklist = validateDecisionChecklist(filePath);
      if (!checklist.valid) {
        removeCompletionMarker(filePath);
        for (const item of checklist.unchecked) {
          log.warn(`  Unchecked: ${item.text}`);
        }
        return { advanced: false, reason: "incomplete_checklist" };
      }
    }
    ```
    Update `AdvancementResult.reason` union type to include `"incomplete_checklist"`.

11. **`src/cli/drive.ts`** — Add post-execution hint. After dispatching `"ready_to_execute"`, if the task advances to `ai_qa`:
    ```typescript
    log.info(`Task #${taskNumber} is ready for QA -- run 'vibe-racer drive' to start the QA lap.`);
    ```
    Also update the no-selection hint for `fine_tuning` to reference `05_qa.md` and for `need_decision` to reference `06_decision.md` (these are already handled by `STAGE_QUESTIONS_FILE` lookups).

12. **`src/cli/pitwall.ts`** — Verify new stages render correctly. The existing grouping logic (`isAgentStage`, `isHumanStage`) should already handle `ai_qa` and `need_decision` correctly since milestone 1 added them to the appropriate sets. Verify no hardcoded stage lists need updating.

13. **`tests/pipeline/handlers/qa.test.ts`** (new file) — Tests:
    - `handleQa` calls `runAndStream` with stage `"ai_qa"` and correct allowed tools
    - After session, `05_qa.md` existence is checked
    - Completion checkbox is appended
    - Stage advances to `fine_tuning`
    - Commit message contains "QA review"

14. **`tests/pipeline/validation.test.ts`** (new file or extend) — Tests:
    - `validateDecisionChecklist` with all checkboxes ticked: `valid: true`
    - `validateDecisionChecklist` with some unchecked: returns the unchecked items with line numbers
    - Completion marker (`- [x] Ready to advance`) is NOT counted as unchecked (it uses `[x]`)

15. **`tests/state/advancement.test.ts`** — Add tests:
    - `tryAdvance` at `need_decision` with unticked checklist items: returns `incomplete_checklist`, unchecks completion marker
    - `tryAdvance` at `need_decision` with all items ticked: advances to `done`

16. **`tests/cli/pitwall.test.ts`** — Verify `ai_qa` shows in agent tasks, `need_decision` shows in human tasks.

17. **`tests/claude/prompts.test.ts`** — Add tests for `qaPrompt` and `decisionPrompt`:
    - QA prompt contains adversarial framing
    - QA prompt includes all six mandatory sections
    - Decision prompt references `06_decision.md`
    - Both accept optional skills parameter

### Test requirements

- All new handler, validation, advancement, and prompt tests pass
- End-to-end stage flow: `ready_to_execute` -> `ai_qa` -> `fine_tuning` -> `cleanup_ready` -> `need_decision` -> `done`
- Checklist enforcement blocks advancement when items unchecked
- Build, lint, typecheck pass

---

## Milestone 6: Docs + Cleanup

### Goal

Update all documentation to reflect the seven-lap pipeline, update CHANGELOG, and delete `vibe-racer-fix.md`.

### Tasks

1. **`README.md`** — Update:
   - Tagline: "Seven laps from objective to shipped code -- you call the pit stops."
   - "The Five Laps" section becomes "The Seven Laps" with updated diagram and table (add Lap 6: QA and Lap 7: Decision)
   - "repeat through all five laps" -> "repeat through all seven laps"
   - Add `skills` to the configuration example

2. **`CLAUDE.md`** — Update any references to five laps, and ensure the project structure section reflects new files (`qa.ts`, `skills.ts`).

3. **`docs/how-it-works.md`** — Update pipeline description, stage list, and flow diagrams for seven laps.

4. **`docs/pipeline.md`** (if exists) — Update stage machine documentation. Add QA and decision stage descriptions. Document the power-user escape hatch (manually setting `stage: ai_qa` to re-run QA).

5. **`docs/commands.md`** — Update `drive` command description to mention QA hint. Update `--retry` description.

6. **`docs/configuration.md`** — Add `skills` configuration documentation with example.

7. **`CHANGELOG.md`** — Add entry for this release covering all three workstreams.

8. **Delete `vibe-racer-fix.md`** from the repo root.

### Test requirements

- No stale "five lap" references remain in any documentation file
- `vibe-racer-fix.md` is deleted
- Build passes (no broken imports from deleted files)
- `npm run lint` passes

---

## Dependency Graph

```
M1 (Schema)
├── M2 (Trivial Re-Plumb) ── depends on M1
│   └── M3 (Guard + Error) ── depends on M1, M2
├── M4 (Skills) ── depends on M1
│
└── M5 (QA + Decision) ── depends on M1, M2, M3, M4
    └── M6 (Docs) ── depends on M1-M5
```

M2 and M4 are independent of each other but both depend on M1. M3 depends on M2. M5 depends on all of M1-M4. M6 depends on M5.

---

## Test Strategy

### Layer 1: Unit Tests (per milestone)

Each milestone adds focused unit tests for the code it introduces or modifies. Tests follow existing patterns:
- `vitest` with `describe`/`it`/`expect`/`vi`
- Module mocking via `vi.mock()` with hoisted factories
- Real filesystem via `mkdtempSync` for state/advancement tests
- `makeGuard()` helper pattern for guard tests

### Layer 2: Integration Tests

- **Stage order regression** — `tests/pipeline/states.test.ts` guards against reordering
- **Advancement flow** — `tests/state/advancement.test.ts` verifies `tryAdvance` at `need_decision` with checklist enforcement
- **Backward compatibility** — old `state.yml` files (without `ai_qa`/`need_decision` in history) parse and render

### Layer 3: Acceptance Verification (Manual)

| AC | Verification |
|---|---|
| AC1 | End-to-end task produces `00_objective.md` through `06_decision.md` |
| AC2 | Seed fixture with unmet criterion, verify `05_qa.md` reports it |
| AC3 | `06_decision.md` items trace to objective, plan, QA risks |
| AC4 | Guard denies `state.yml` write at review, execution, QA stages |
| AC5 | `setError` on corrupt `state.yml` writes valid error record |
| AC6 | Trivial task works without agent writing `state.yml` |
| AC7 | Configured skill appears in prompt; missing skill warns, lap completes |
| AC8 | `pitwall` renders new stages; `drive` hints correct files |
| AC9 | `tryAdvance` at `need_decision` rejects unticked checklist |
| AC10 | `--retry` restores failed stage; legacy `error_stage` produces message |
| AC11 | Docs reflect seven laps; `vibe-racer-fix.md` deleted |

### Continuous Verification

Every milestone ends with:
```bash
npm run build && npm run typecheck && npm run test && npm run lint
```
