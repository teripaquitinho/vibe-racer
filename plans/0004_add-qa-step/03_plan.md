# Implementation Plan: Add QA Step (#4)

> **Stage**: `ai_plan_review`
> **Date**: 2026-08-24

---

## Implementation Strategy

Build order is driven by **risk and dependency**, not by workstream label. The three workstreams (A: state.yml protection, B: skills, C: QA + decision) share overlapping files, so they are interleaved by layer:

1. **Schema first** — everything depends on the stage enum. The enum insertion lands here; the
   `STAGE_QUESTIONS_FILE[fine_tuning]` remap deliberately does **not** (see below).
2. **Trivial re-plumb before guard** — the current trivial path has the agent write `state.yml`. Rule 0 would silently break it. Re-plumbing first keeps every intermediate commit honest.
3. **Guard + error recovery** — highest-risk changes to security enforcement. Ships early but after the trivial dependency is removed.
4. **Skills** — independent module, but prompts need it wired before QA/decision prompts can reference skills.
5. **QA, then decision** — the two new stages, wired end to end, split across two milestones.
6. **Docs + cleanup** — final pass, deletes `vibe-racer-fix.md`.

**Every intermediate commit must leave a working pipeline.** This is the same principle that puts M2
before M3, applied consistently. It is why the `STAGE_QUESTIONS_FILE[fine_tuning]` remap moved out of
M1 and into M5a: remapping it in M1, while `handleExecute` still advances to `fine_tuning` until M5a,
would point every task that finishes execution at an `05_qa.md` that nothing writes — for four
milestones, with no forward path. The map entry and the handler that produces the file belong in the
same commit.

---

## Milestone Overview

| # | Name | Key Output | Dependencies |
|---|---|---|---|
| 1 | Schema + State Machine | 16-stage enum, `AGENT_STAGES`, `STAGE_NEXT_NAME`, regression tests | None |
| 2 | Trivial Fast-Path Re-Plumb | Agent signals triviality via file artifact, handler sets `trivial: true` | M1 |
| 3 | Guard Hardening + Error Recovery | Rule 0, split review stages, `setError` hardening, validate-on-write, `--retry` fix | M1, M2 |
| 4 | Skills Module | `skills.ts` with `LAP_BY_STAGE` + verified defaults, session changes, config extension, prompt builder | M1 |
| 5a | QA Handler + Execute Rewiring | `handleQa`, `05_qa.md`, execute advances to `ai_qa`, `fine_tuning` remap, AC2 fixture | M1-M4 |
| 5b | Decision Stage + Checklist Enforcement | `handleDone` writes `06_decision.md`, parks at `need_decision`, `tryAdvance` enforcement | M5a |
| 6 | Docs + Cleanup | README, `package.json`, `src/cli/index.ts`, all docs, CHANGELOG. Delete `vibe-racer-fix.md` | M1-M5b |

---

## Milestone 1: Schema + State Machine

### Goal

Extend the stage enum from 14 to 16 entries, update all stage maps and helpers, and confirm the existing test suite passes with the new stage order.

### Existing code reused

- `src/state/schema.ts` — extend `STAGES` array
- `src/pipeline/states.ts` — extend `AGENT_STAGES`, `STAGE_QUESTIONS_FILE`, `STAGE_NEXT_NAME`
- `tests/state/schema.test.ts` — extend with new stage parsing tests
- `tests/pipeline/states.test.ts` — extend; already covers the existing stage order

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
   - `STAGE_QUESTIONS_FILE`: add `need_decision: "06_decision.md"`.
     **Do NOT remap `fine_tuning` in this milestone.** It stays `"04_execute.md"` until M5a task 1.
     `handleExecute` still advances to `fine_tuning` until M5a task 6, so remapping now points
     every task that finishes execution at an `05_qa.md` that nothing writes — for four
     milestones. `tryAdvance` returns `no_questions_file` and the task is stranded with no
     forward path. The remap belongs in the same commit as the handler that produces the file.
   - `STAGE_NEXT_NAME`: add `need_decision: "Done"` (keep `fine_tuning: "Cleanup"` unchanged)

3. **`tests/state/schema.test.ts`** — Add tests:
   - All 16 stages parse via `stateSchema.parse()`
   - `STAGES.length === 16`

4. **`tests/pipeline/states.test.ts`** (**EXTEND — this file already exists, 74 lines. Add to it; do not overwrite it.**)

   **First, two existing assertions become false and MUST be edited** — inserting `need_decision`
   between `cleanup_ready` and `done` changes both transitions:
   - `:46` `expect(nextStage("cleanup_ready")).toBe("done")` → `.toBe("need_decision")`
   - `:57` `expect(previousStage("done")).toBe("cleanup_ready")` → `.toBe("need_decision")`

   This is the one sanctioned exception to the playbook's "coverage only goes up" rule: these are
   *corrections* to assertions the change deliberately invalidates, not deletions. Do not delete or
   skip them — edit the expected value. Total test count must not drop.

   Then add the stage order regression tests:
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
- `tests/state/store.test.ts` — extend (already exists, 120 lines) with `setError` hardening tests
- `tests/claude/fasten.test.ts` — **will break.** Line 103 asserts the exact `runAndStream`
  options object for `src/claude/fasten.ts`; adding `plansDir` changes that shape.

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

3. **`src/claude/guard.ts`** — Insert Rule 0 in `createToolGuard`. Placement is exact: it goes
   **immediately after `const resolved = resolveToolPath(rawPath, cwd);` and before Rule 1**.
   That line sits inside `if (PATH_TOOLS.has(toolName))` → `if (rawPath !== null)`, and `resolved`
   does not exist outside it — a rule placed literally at the top of the guard body will not compile.

   ```typescript
   // Rule 0: Deny agent writes to state.yml under plans_dir
   if (toolName === "Write" || toolName === "Edit") {
     const plansRoot = realpathIfExists(path.resolve(options.cwd, options.plansDir)) + sep;
     if (path.basename(resolved) === "state.yml" && resolved.startsWith(plansRoot)) {
       return deny(toolName, rawPath, "state.yml is owned by the pipeline");
     }
   }
   ```

   **Two correctness requirements, both easy to get wrong:**

   - **Trailing separator.** A bare `startsWith(plansRoot)` also matches `<cwd>/plans-archive/state.yml`.
     Rule 4 already does this correctly (`resolve(cwd, taskPlanPath) + sep`) — copy that shape.
   - **Realpath both sides.** `resolved` comes back from `resolveToolPath`, which runs `realpathSync`.
     `path.resolve` does not. Under any symlinked path the two sides never share a prefix and
     **Rule 0 silently never fires**. This is not hypothetical: on macOS `/tmp` is a symlink to
     `/private/tmp`, which is exactly what `mkdtempSync(os.tmpdir())` hands your guard tests. Add a
     small `realpathIfExists()` helper (realpath, falling back to the input on ENOENT — `plans/` may
     not exist yet in a fresh project) and use it on `plansRoot`.

   Add a guard test that runs under `mkdtempSync(os.tmpdir())` specifically, so a regression here
   fails loudly instead of passing vacuously.

   **Known limitation — accepted, not fixed here.** Rule 0 only sees `Write` and `Edit`, because the
   guard's path rules are gated on `PATH_TOOLS = {Read, Write, Edit, Glob, Grep}`. `Bash` reaches only
   Rule 5 (the command blocklist), which does not restrict in-project writes, and `Bash` *is* in
   `allowedTools` at `ready_to_execute`, `ai_qa`, and `cleanup_ready`. So `echo … > plans/NNNN/state.yml`
   and `sed -i` remain possible. This is a deliberate scope decision: the incident in `vibe-racer-fix.md`
   was an agent using `Write`, and no prompt instructs an agent to shell-write `state.yml`. Do **not**
   silently ship it as closed — M5b task 7 requires `06_decision.md` to carry it as a named residual
   risk, and AC4 is scoped to `Write`/`Edit` accordingly.

4. **`src/claude/guard.ts`** — Rules 4a and 4b. **These go in two different places; 4b is a new
   rule, not an edit to Rule 4.**

   - **Rule 4a** — edit the existing Rule 4 in place (`guard.ts:311-317`), swapping `REVIEW_STAGES`
     for `PLAN_JAILED_STAGES`. Everything else about it is unchanged, including its `+ sep` compare.
     ```typescript
     if (PLAN_JAILED_STAGES.has(options.stage) && (toolName === "Write" || toolName === "Edit")) { … }
     ```

   - **Rule 4b** — a genuinely new rule, and it **cannot live where Rule 4 lives**. Rule 4 is nested
     inside `if (PATH_TOOLS.has(toolName)) { if (rawPath !== null) { … } }`, and `PATH_TOOLS` is
     `{Read, Write, Edit, Glob, Grep}` — **`Bash` is not in it**, so a Bash rule placed there can
     never fire, and M3 task 13's "Bash denied at `ai_objective_review`" test would fail.

     Place it **after the `PATH_TOOLS` block closes and immediately before Rule 5** (the existing
     `if (toolName === "Bash")` command-filter block at `guard.ts:323`):
     ```typescript
     // Rule 4b: review stages may not shell out at all
     if (BASH_BLOCKED_STAGES.has(options.stage) && toolName === "Bash") {
       return deny(toolName, String(input.command ?? ""), "review stage: bash not permitted");
     }
     ```
     This is new enforcement. Today Bash is kept out of review stages only by each handler's
     `ALLOWED_TOOLS`; `formatGuardSummary` has been *printing* `bash: blocked (review stage)`
     (`guard.ts:348-350`) without anything enforcing it. Rule 4b makes that message true for the
     first time — it is not a refactor.

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

7. **`src/claude/session.ts`** — Pass `plansDir` to `createToolGuard`. **Do not derive it from `taskPlanPath`.** `src/claude/fasten.ts:110` calls `runAndStream` with `taskPlanPath: ""`, so `path.dirname("")` yields `"."`, which resolves `plansRoot` to the project root and makes Rule 0 deny writes to *every* `state.yml` in the project during a fasten run.

   (Note: it is `src/claude/fasten.ts`, not `src/cli/fasten.ts` — the CLI command calls
   `runFastenAnalysis(cwd)` and never touches `runAndStream`.)

   `TaskContext.plansDir` already holds exactly this value. Thread it through explicitly:
   ```typescript
   // SessionOptions gains:
   plansDir?: string;

   createToolGuard({
     cwd: options.cwd,
     stage: options.stage,
     taskPlanPath: options.taskPlanPath ?? "",
     plansDir: options.plansDir ?? loadConfig(options.cwd).plans_dir,
   });
   ```
   **Do not hardcode `?? "plans"`.** `plans_dir` is configurable and `loadConfig` already defaults it
   to `"plans"`. A project with `plans_dir: docs/plans` that takes a literal `"plans"` fallback gets
   Rule 0 aimed at a directory that does not exist — the protection silently does nothing, with no
   error and no audit entry. `src/claude/fasten.ts` is precisely the caller this plan says may omit
   the field, so it is the case that breaks.

   Every pipeline handler passes `plansDir: ctx.plansDir` explicitly. `src/claude/fasten.ts` may omit
   it and take the config-derived fallback.

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
     try {
       writeState(planPath, {
         ...salvaged,
         stage: "error",
         title: salvaged.title ?? path.basename(planPath),
         error_stage: errorStage,
         error_message: message,
       } as TaskState);
     } catch {
       // Last resort: writeState now validates (task 9), so it can reject. setError is the
       // final line of defence and must never throw — hand-write a minimal valid record.
       writeFileSync(
         path.join(planPath, STATE_FILE),
         stringify({
           stage: "error",
           title: path.basename(planPath),
           error_stage: errorStage,
           error_message: message,
           prev: null,
           next: null,
           updated: new Date().toISOString(),
         }),
         "utf-8",
       );
     }
   }
   ```

   **The try/catch around `writeState` is not optional, and it is why task 8 and task 9 must land
   together.** Task 9 adds validate-on-write in this same milestone. Without the catch, the function
   whose entire purpose is to survive a broken `state.yml` gains a brand-new way to throw —
   reintroducing the exact double-failure from `vibe-racer-fix.md`, where `setError` died and printed
   `Failed to save error state` on top of the original error.

9. **`src/state/store.ts`** — Add validate-on-write to `writeState`. After computing `prev`/`next`/`updated`, validate:
   ```typescript
   const updated = { ...state, prev, next, updated: new Date().toISOString() };
   stateSchema.parse(updated);  // throws on invalid state
   writeFileSync(filePath, stringify(updated), "utf-8");
   ```

10. **`src/pipeline/handlers/safe-wrapper.ts`** — While in this file, close the secret-scan gap on the
    error path. `commitAll` only runs `scanForSecrets` when a third `cwd` argument is passed, and the
    error handler currently calls `commitAll(git, "vibe-racer: partial work (error) …")` with no `cwd`.
    So the one commit most likely to contain half-finished work — an aborted session's partial output —
    is the only commit in the codebase that skips secret scanning.

    **Passing `ctx.cwd` alone is not enough.** That call sits inside
    `try { … } catch { /* Nothing to commit — that's fine */ }` (`safe-wrapper.ts:18-24`), which
    swallows every error including a secret detection. Two changes are needed:
    - `src/git/operations.ts:21` — **export `SecretDetectedError`** (currently
      `class SecretDetectedError extends Error`, unexported, so it cannot be `instanceof`-checked
      from another module).
    - `safe-wrapper.ts` — narrow the catch so a secret detection is logged loudly and rethrown,
      while "nothing to commit" stays swallowed:
      ```typescript
      try {
        await commitAll(git, `vibe-racer: partial work (error) for #${ctx.taskNumber}`, ctx.cwd);
      } catch (e) {
        if (e instanceof SecretDetectedError) throw e;   // never bury this
        // Nothing to commit — that's fine
      }
      ```
    Note the ordering consequence: rethrowing here means `setError` (line 28) is skipped on a
    secret-detection path. That is correct — a secret in the working tree is a louder problem than
    an unrecorded error stage — but call it out in the CHANGELOG.

    Then change `withErrorHandling` to accept a `Stage` instead of a handler name string:
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

12. **`src/cli/drive.ts`** — Fix `--retry` logic. **This replaces the existing dispatch call; it does
    not precede it.** Today `drive.ts` ends with a single unconditional `await dispatch(task.stage, ctx);`
    (line ~109). Inserting a retry block above it and leaving that line in place dispatches **twice** —
    once for the restored stage, then again for `"error"`, and the second call throws
    `No handler for state: error`, which is the bug being fixed.

    Note also there is no `state` variable in this function. The selected task is `task` (from
    `selectTask`), its stage is `task.stage`, and `ctx` is built *after* selection — so the block has
    to sit where `ctx` already exists. Resolve the target stage first, dispatch once:

    ```typescript
    // replaces: await dispatch(task.stage, ctx);
    let target: Stage = task.stage;

    if (task.stage === "error") {
      const errorStage = readState(task.planPath).error_stage;
      if (errorStage && (STAGES as readonly string[]).includes(errorStage)) {
        target = errorStage as Stage;
        updateStage(task.planPath, target);
        log.info(`Retrying task #${task.number} from [${target}]`);
      } else {
        log.error(`Task #${task.number} failed at '${errorStage ?? "unknown"}' (unrecognized stage).`);
        log.error(`Set 'stage:' in ${task.planPath}/state.yml manually and re-run 'drive'.`);
        return;
      }
    }

    await dispatch(target, ctx);
    ```
    Import `STAGES` from `../state/schema.js` and `readState` from `../state/store.js`.
    There must be exactly one `dispatch` call on this path when you are done.

    **`task.planPath` is already absolute — do not join it with `cwd`.** `drive.ts:26` builds
    `plansDir = path.join(cwd, config.plans_dir)` and `discovery.ts:28` builds
    `planPath = path.join(plansDir, entry.name)`, so it is a full path. `drive.ts:45` already calls
    `readState(task.planPath)` with no join. Joining would produce `<cwd>/<cwd>/plans/...`, throw
    ENOENT inside `readState`, and send **every** retry down the "unrecognized stage" branch — the
    failure would look exactly like the legacy-`error_stage` case this task is meant to fix.
    `updateStage(task.planPath, target)` takes the same absolute path.

13. **`tests/claude/guard.test.ts`** — Add tests:
    - Rule 0: `Write` to `<planPath>/state.yml` denied at review stage, execution stage, and QA stage
    - Rule 0: `Write` to `<planPath>/02_design.md` still allowed at review stage
    - Rule 0: `Write` to a `state.yml` outside `plansDir` is allowed (not blocked)
    - Rule 4a: `Write` at `ai_qa` jailed to plan directory
    - Rule 4b: `Bash` denied at `ai_objective_review` (review stage)
    - Rule 4b: `Bash` allowed at `ai_qa`
    - `Skill` tool explicitly allowed
    - Update `makeGuard` helper to include `plansDir`

14. **`tests/state/store.test.ts`** (**EXTEND — already exists, 120 lines**) — Tests:
    - `setError` with valid `state.yml` — writes `stage: "error"` with `error_stage` set to a stage name
    - `setError` with invalid YAML in `state.yml` — writes a valid error record, salvaging `title`/`created`/`trivial`
    - `setError` with missing `state.yml` — writes a valid error record with fallback title
    - `setError` when the salvaged record would fail `stateSchema.parse()` — still writes a valid
      record and does **not** throw (guards the task 8 / task 9 interaction)
    - Regression from `vibe-racer-fix.md`: `setError` on a plan dir whose `state.yml` holds
      `next: ai_plan` writes a valid `stage: error` file instead of throwing
    - `writeState` with invalid state object — throws Zod validation error

15. **`tests/pipeline/safe-wrapper.test.ts`** — Update to pass stage names instead of handler names.

16. **`tests/cli/drive.test.ts`** — Add `--retry` tests:
    - Task in error with valid `error_stage` (a real stage) — restores and dispatches
    - Task in error with legacy handler-name `error_stage` — prints message, does not throw
    - **`dispatch` is called exactly once** in both cases (guards the double-dispatch regression)

    **Extend the existing `state/store.js` mock factory first.** `drive.test.ts:23-25` currently
    exports only `readState`; task 12's retry path also calls `updateStage`, which would be
    `undefined` at call time and throw. Add `updateStage: vi.fn()` to that factory, and have
    `readState` return an `error_stage` for the retry cases.

17. **`tests/claude/fasten.test.ts`** — **No change needed. Verified, not assumed.** An earlier
    revision of this plan claimed line 103 asserts an exact options object and would break. It does
    not: all three assertions in that file (`:96`, `:108`, `:121`) use
    `expect.objectContaining({...})`, so adding fields cannot break them. `src/claude/fasten.ts` is
    also not modified in this milestone — it takes the config-derived `plansDir` fallback from
    task 7. Run the file to confirm it stays green; do not edit it.

### Test requirements

- All existing tests pass (with updates for changed signatures)
- Guard tests cover Rule 0, split stages, Skill allow
- Store tests cover `setError` hardening and validate-on-write
- `--retry` tests cover both valid and legacy `error_stage`
- Build, lint, typecheck pass

---

## Milestone 4: Skills Module

### Goal

Create the skills resolution module, wire `Skill` into sessions, extend the config schema, and add a
prompt builder for skills sections. **Every lap gets skills, not just QA** — via a stage→lap map, so
no handler needs to change.

### Existing code reused

- `src/claude/session.ts` — `settingSources`, skill resolution, `Skill` in tools
- `src/claude/prompts.ts` — add `buildSkillsSection()`
- `src/config/schema.ts` — add `skills` key
- `src/claude/fasten.ts` — opt out of lap skills (see task 7)

### Genuinely new

- `src/claude/skills.ts` — `LAP_BY_STAGE`, `DEFAULT_SKILLS`, `resolveSkills()`, `partitionSkills()`

---

### Spike result — ALREADY RUN, do not re-run

The plan lap ran the probe spike against this repo on 2026-08-24. **The probe approach works.**
Take the probe path as written below; the streaming-input fallback is not needed.

Script: `query({ prompt: "", options: { cwd, settingSources, maxTurns: 0 } })`, then
`await q.supportedCommands()`, then `await q.return(undefined)`.

| Result | Observation |
|---|---|
| Works on a freshly constructed query? | **Yes.** No session initialisation required. |
| Latency | 0.8–1.2s per probe |
| `settingSources: ["project"]` | 17 entries |
| `settingSources: ["project", "user"]` | 18 entries |
| Delta from adding `"user"` | exactly one: `frontend-design` |
| Entry shape | `{ name: string, description: string, argumentHint: string }` |
| `probe.return(undefined)` | returns cleanly, no throw |

Full inventory returned (both scopes, `"user"` adds only `frontend-design`):

```
batch, claude-api, compact, context, cost, debug, extra-usage, frontend-design,
heapdump, init, insights, loop, review, schedule, security-review, simplify,
team-onboarding, update-config
```

**Three findings that change the design:**

1. **`supportedCommands()` returns every slash command, not only skills, and names are not unique.**
   `compact`, `context`, `cost`, `debug`, `heapdump`, `extra-usage`, `insights` are harness commands.
   `partitionSkills` matches on name, so a configured name like `compact` resolves as "available" and
   gets advertised in the prompt.

   **This stopped being hypothetical during the plan lap.** Ten locally-authored skills were installed
   to `~/.claude/skills/` and probed. Nine resolved cleanly. The tenth, `debug`, **collided with the
   bundled `debug` command** — the probe returned *two entries with the same name*:

   ```
   entries: 28   unique names: 27   duplicates: debug x2
     [0] "Enable debug logging for this session and help diagnose issues (bundled)"
     [1] "Structured debugging session — reproduce, isolate, diagnose, and fix…"
   ```

   `partitionSkills` builds `new Map(installed.map(s => [s.name, s]))`, which silently keeps the
   **last** entry for a duplicated key. So the description advertised in the prompt depends on
   iteration order, and which one the `Skill` tool actually invokes is undefined. No warning fires,
   because the name resolves. **An ambiguous resolution is worse than a missing skill** — the missing
   one at least trips AC7's warning.

   Two consequences, both mandatory:
   - `partitionSkills` must detect and report duplicates (task 1 below).
   - Locally-authored skills must not shadow bundled names. The colliding skill was renamed
     `debug` → `eng-debug`, after which the probe reported 28 entries / 28 unique / no duplicates.

   The config docs (M6 task 11) must not describe this list as "your installed skills", and must warn
   that a name colliding with a bundled command resolves ambiguously rather than warning.

2. **The `"user"` scope is correct, but the objective's stated reason for it is wrong.**

   `00_objective.md` says account-level engineering skills are invisible "because sessions run with
   `settingSources: ["project"]`, and account skills resolve from user scope." That premise does not
   hold. **claude.ai account/org skill catalogues are a different system entirely** — they live
   server-side, scoped to a Claude.ai workspace, reachable from claude.ai (and Cowork/Tag) but not
   from the CLI or the Agent SDK. There is no filesystem path, no package to install, and no
   `settingSources` value that surfaces them. If an operator has an org catalogue like
   `engineering:code-review`, vibe-racer **cannot use it**, before or after this change.

   What `"user"` scope actually delivers is **locally-authored skills in `~/.claude/skills/`**, plus
   user-scope plugins. Verified during the plan lap with a canary skill:

   | `settingSources` | commands | `~/.claude/skills/` canary visible? |
   |---|---|---|
   | `["project"]` | 17 | no |
   | `["project", "user"]` | 19 | **yes** |

   So the change earns its keep — just for a different reason than the objective gives. Keep it, and
   describe it accurately in `docs/configuration.md` (M6 task 11) so operators do not expect their
   claude.ai skills to appear.

   The cost is unchanged and still real: user-scope settings also carry hooks, permissions, MCP
   servers, and `additionalDirectories` into every vibe-racer session — and those sessions run
   `permissionMode: "bypassPermissions"`, so `canUseTool` is the only thing between a user-scope hook
   and the project. **Record this as a named residual risk in `06_decision.md`** (M5b task 7).

3. **The machine has no locally-installed engineering skills.** `~/.claude/skills/` does not exist;
   the only installed plugin is `frontend-design`. The official marketplace (286 plugins) has
   `code-review`, `pr-review-toolkit`, `security-guidance`, `code-modernization`, and `typescript-lsp`
   available but **not installed** — and most of them ship commands/agents with no `skills/`
   directory, so installing one does not necessarily add anything to `supportedCommands()`.

   **`DEFAULT_SKILLS` must contain bundled skills only.** This is a hard constraint, not a
   preference. vibe-racer runs with `cwd` set to the *host* project, so `["project"]` resolves that
   project's `.claude/skills/` and `["user"]` resolves the operator's home — neither is anything
   vibe-racer can ship or guarantee. Only bundled skills are present for every operator on every
   project. `simplify` and `security-review` are bundled; that is why they are the defaults and why
   the list is short. Anything operator-specific belongs in `.vibe-racer.yml`, not in the defaults.

---

### Tasks

1. **`src/claude/skills.ts`** (new file):

   ```typescript
   import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
   import type { Stage } from "../state/schema.js";
   import type { VibeRacerConfig } from "../config/schema.js";

   /**
    * Every agent stage maps to exactly one lap. This bijection is what lets all seven laps
    * pick up skills without threading a `lap` argument through six call sites — runAndStream
    * already receives `stage`.
    */
   export const LAP_BY_STAGE: Partial<Record<Stage, string>> = {
     ai_objective_review: "objective",
     ai_product_review:   "product",
     ai_design_review:    "design",
     ai_plan_review:      "plan",
     ready_to_execute:    "execute",
     ai_qa:               "qa",
     cleanup_ready:       "decision",
   };

   /**
    * Verified installed as of 2026-08-24 (see Spike result above). Names here MUST appear in
    * `supportedCommands()` output — an unverified name costs a warning on every single lap.
    */
   export const DEFAULT_SKILLS: Record<string, string[]> = {
     objective: [],
     product:   [],
     design:    [],
     plan:      [],
     execute:   ["simplify"],
     qa:        ["security-review"],
     decision:  [],
   };

   export function resolveSkills(lap: string, config: VibeRacerConfig): string[] {
     return config.skills?.[lap] ?? DEFAULT_SKILLS[lap] ?? [];
   }

   export function partitionSkills(
     requested: string[],
     installed: SlashCommand[],
   ): { available: SlashCommand[]; missing: string[]; ambiguous: string[] } {
     // Names are NOT unique — a local skill can shadow a bundled command (observed: `debug`).
     // Count first, so a duplicated name is reported rather than silently resolved.
     const counts = new Map<string, number>();
     for (const s of installed) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);

     const installedMap = new Map(installed.map(s => [s.name, s]));
     const available: SlashCommand[] = [];
     const missing: string[] = [];
     const ambiguous: string[] = [];
     for (const name of requested) {
       const skill = installedMap.get(name);
       if (!skill) { missing.push(name); continue; }
       if ((counts.get(name) ?? 0) > 1) ambiguous.push(name);
       available.push(skill);
     }
     return { available, missing, ambiguous };
   }
   ```

   `ambiguous` names are still passed through to the prompt — dropping them would be a worse
   failure than using them — but `runAndStream` must log a distinct warning naming each one, so an
   operator can rename their local skill. Silence here is the bug.

   **Why only two defaults — the mapping is evidence-based, and the exclusions matter as much
   as the inclusions:**

   | Skill | Lap | Reason |
   |---|---|---|
   | `security-review` | `qa` | "Complete a security review of the pending changes **on the current branch**." Branch-scoped, review-only, does not modify code — which is exactly the QA contract (judge, don't fix). It also gives QA a diff-scoped lens it otherwise lacks. |
   | `simplify` | `execute` | "Review changed code for reuse, quality, and efficiency, **then fix any issues found**." It fixes, so it belongs in execute and must **not** go in QA. |

   | Rejected | Why not |
   |---|---|
   | `review` | "Review a pull request." vibe-racer never pushes and no PR exists at any lap. |
   | `claude-api` | Genuinely useful *in this repo*, but trigger-gated on Anthropic SDK imports and meaningless for a host project that isn't LLM-shaped. Ship it as a documented config example (M6), not a built-in default. |
   | `init` | Bootstraps a CLAUDE.md; `handleDone`'s docs pass already owns that ground. |
   | `frontend-design` | UI-specific, user-scope only, wrong shape for a default that ships to every project. |
   | `batch` | "Execute in parallel across 5–30 isolated worktree agents that each open a PR." Actively hazardous inside an autonomous lap. Never default this. |
   | `loop`, `schedule` | Recurring/scheduled execution inside a one-shot lap. |
   | `compact`, `context`, `cost`, `debug`, `heapdump`, `extra-usage`, `insights`, `team-onboarding`, `update-config` | Harness/meta commands, not engineering skills. |

2. **`src/claude/prompts.ts`** — Add `buildSkillsSection()`:
   ```typescript
   import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";

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
   Descriptions come straight from `supportedCommands()`, so they cannot drift from the skill.

3. **`src/config/schema.ts`** — Add `skills` to the config schema:
   ```typescript
   skills: z.record(z.string(), z.array(z.string())).optional(),
   ```
   Do NOT touch `repo`, `plans_dir`, or `context`. (`repo`'s `.refine()` deliberately accepts SSH
   remotes; replacing it with `z.string().url()` would reject every `git@github.com:` form.)
   zod is v4 here, where `z.record` requires the two-argument form — the above is correct.

4. **`src/claude/session.ts`** — Change `settingSources`:
   ```typescript
   settingSources: ["project", "user"],
   ```

5. **`src/claude/session.ts`** — Add `lap?: string | null` to `SessionOptions` and derive it from
   `stage` when not given. **This is what makes all seven laps work** — no handler changes needed:
   ```typescript
   const lap = options.lap === null
     ? undefined
     : options.lap ?? (options.stage ? LAP_BY_STAGE[options.stage] : undefined);
   ```
   Explicit `null` opts a session out entirely (used by `src/claude/fasten.ts`, task 7).

6. **`src/claude/session.ts`** — Resolve skills and run the probe in `runAndStream`, before building
   the prompt:
   ```typescript
   let skillsSection = "";
   let skillsRequested = false;
   if (lap) {
     const config = loadConfig(options.cwd);
     const requested = resolveSkills(lap, config);
     if (requested.length > 0) {
       skillsRequested = true;
       const probe = query({
         prompt: "",
         options: { cwd: options.cwd, settingSources: ["project", "user"], maxTurns: 0 },
       });
       try {
         const installed = await probe.supportedCommands();
         const { available, missing, ambiguous } = partitionSkills(requested, installed);
         if (missing.length > 0) {
           log.warn(`Skills not found (dropped from prompt): ${missing.join(", ")}`);
         }
         if (ambiguous.length > 0) {
           log.warn(
             `Skill name collision — more than one command matches: ${ambiguous.join(", ")}. ` +
             `Rename your local skill in ~/.claude/skills/ to disambiguate.`,
           );
         }
         skillsSection = buildSkillsSection(available);
       } catch (err) {
         // A failed probe must not fail the lap — degrade to persona-only.
         log.warn(`Skill discovery failed, continuing without skills: ${String(err)}`);
         skillsRequested = false;
       } finally {
         // Query extends AsyncGenerator<SDKMessage, void>, so `return` takes a
         // required argument — `probe.return()` with no args does not typecheck.
         await probe.return(undefined);
       }
     }
   }
   ```
   A lap with an empty skill list never spawns a probe, so it pays nothing. With the defaults above
   that is five of the seven laps.

7. **`src/claude/session.ts` / `src/claude/fasten.ts`** — Add `"Skill"` to `allowedTools` only when
   `skillsRequested` is true and `skillsSection` is non-empty. Then update `src/claude/fasten.ts:110`
   to pass `lap: null` — it borrows `stage: "ai_objective_review"` for guard purposes but is not a
   pipeline lap, and should not inherit whatever an operator configures for `objective`.

8. **`tests/claude/skills.test.ts`** (new file):
   - `LAP_BY_STAGE` covers every stage in `AGENT_STAGES` plus `ai_qa`, and maps each to a distinct
     lap name that exists as a key in `DEFAULT_SKILLS` (**this test is what stops a lap from
     silently losing skills** — it is the regression guard for the bug where only QA was wired)
   - Every name in `DEFAULT_SKILLS` is non-empty and lowercase-kebab (cheap typo guard)
   - `resolveSkills` with a config override returns config values, not defaults
   - `resolveSkills` with no config returns the built-in defaults
   - `resolveSkills` with an unknown lap returns `[]`
   - `partitionSkills` splits correctly; available entries are full `SlashCommand` objects
   - `partitionSkills` with empty inputs returns empty outputs
   - **`partitionSkills` reports a duplicated name in `ambiguous` while still returning it in
     `available`** — regression guard for the observed `debug` collision
   - A requested name present exactly once is **not** reported ambiguous

9. **`tests/claude/session.test.ts`** — Verify `settingSources` includes `"user"`; verify a session
   with a stage whose lap has no configured skills does **not** construct a probe query.

10. **`tests/claude/fasten.test.ts`** — Add `lap: null` to the `expect.objectContaining({...})` in
    the `src/claude/fasten.ts` assertion, since task 7 does modify that call site. Note this is an
    *addition* to an `objectContaining` matcher, not a rewrite — the file will not break on its own
    (see M3 task 17), so run it first and only edit if you want the new field asserted.

### Test requirements

- Skills module unit tests pass, including the `LAP_BY_STAGE` completeness test
- Existing session tests pass with updated `settingSources`
- Config schema accepts a `skills` key and still round-trips SSH `repo` values
- Build, lint, typecheck pass

## Milestone 5a: QA Handler + Execute Rewiring

### Goal

Land the QA lap end to end: `handleQa` writes `05_qa.md`, `handleExecute` advances to `ai_qa`, and
`STAGE_QUESTIONS_FILE[fine_tuning]` moves to `05_qa.md` **in this same commit**. After M5a the
pipeline is coherent again for the first time since M1.

> **M5 was split into M5a and M5b.** The original single milestone carried 17 tasks across 9 source
> files and 5 test files. `handleExecute`'s milestone loop has no iteration cap — it spins until the
> model flips `pending` to `done` — so an oversized milestone is the one most likely to exhaust a
> session mid-way and leave a half-applied commit. `03_plan_questions.md` Q5 warned about exactly
> this ("Coarser milestones risk too much work in a single session"). The split is along the natural
> seam: QA is self-contained; the decision stage depends on `05_qa.md` existing but nothing else.

### Existing code reused

- `src/pipeline/handlers/execute.ts` — post-loop advancement and checkbox
- `src/pipeline/states.ts` — `STAGE_QUESTIONS_FILE[fine_tuning]` remap (deferred from M1)
- `src/pipeline/machine.ts` — register `handleQa`
- `src/claude/prompts.ts` — `qaPrompt()`, `CHAT_PERSONA_MAP`, `CHAT_ROLE_DESCRIPTIONS`

### Genuinely new

- `src/pipeline/handlers/qa.ts` — `handleQa()`
- `tests/pipeline/handlers/qa.test.ts`, `tests/pipeline/handlers/execute.test.ts`
- `tests/fixtures/incomplete-task/` — AC2 fixture

### Tasks

1. **`src/pipeline/states.ts`** — Now remap `STAGE_QUESTIONS_FILE[fine_tuning]` from `"04_execute.md"`
   to `"05_qa.md"`. Deferred from M1 deliberately: this line and task 3 below (which makes something
   write `05_qa.md`) must land in the same commit, or every task finishing execution is stranded.
   Leave `need_execution: "04_execute.md"` alone — the two keys share a file today and only
   `fine_tuning` moves.

2. **`src/claude/prompts.ts`** — Add `qaPrompt(ctx: TaskContext): { prompt: string; persona: string }`.
   **No `skills` parameter.** M4 resolves skills inside `runAndStream` from `stage` via `LAP_BY_STAGE`
   and appends `buildSkillsSection()` there — prompt builders never see them. An earlier revision gave
   every builder a `skills?: SlashCommand[]` argument; under the `LAP_BY_STAGE` design nothing can ever
   pass it, so it would be dead code with a test exercising a path no caller uses. Same for
   `decisionPrompt` (M5b task 1).
   - Persona: `"Senior QA Engineer"`
   - Adversarial framing per `02_design.md`'s QA prompt section — "a QA report that finds nothing
     wrong is a red flag, not a success"
   - Loads `00_objective.md`, `03_plan.md`, `04_execute.md` as context
   - **Also loads `vibe-racer-fix.md`** while it still exists (deleted in M6, per `03_plan_questions.md`
     Q6) so QA can verify Workstream A's three fixes against their source spec
   - Mandatory sections: What works, What doesn't, What regressed, Deviations, Risks and known
     limitations, Verification run
   - Rules: evidence-based claims, no fixing, write to `05_qa.md`

3. **`src/claude/prompts.ts`** — **Give the QA prompt a diff scope.** As specified in `02_design.md`
   the prompt loads three markdown files and never points QA at the code. "What regressed" is close
   to unanswerable without knowing what changed, and "What works … with evidence" invites QA to
   re-read the plan and paraphrase it. QA has `Bash`; use it. Add to the prompt:

   ```
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
   ```

   The fallback clause is load-bearing, not defensive padding: without it, an empty diff makes
   "nothing changed" the locally-reasonable conclusion, and the QA lap reports a clean bill on work
   it never looked at. It is also what makes AC2's fixture verification meaningful (task 8).

   This is also what makes the `security-review` skill (M4) useful here — it operates on pending
   changes on the current branch, the same scope.

4. **`src/claude/prompts.ts`** — **First add two entries to the `PERSONAS` const** (`prompts.ts:4-28`),
   following the existing shape exactly: a multi-sentence `[...].join(" ")` string, not a bare title.
   `CHAT_PERSONA_MAP` maps stages to full `PERSONAS.*` strings (`prompts.ts:492-499`), so a bare
   `"Senior QA Engineer"` would break the established pattern and produce a one-line system prompt
   where every other stage gets a paragraph.
   - `PERSONAS.qaEngineer` — a Senior QA Engineer measured by the real issues they find, not by
     confirming the build passes; evidence over assertion; judges, never fixes.
   - `PERSONAS.releaseManager` — a Release Manager who decides whether work is safe to call
     delivered; thinks in post-deploy verification, blast radius, and rollback.

   Then update `CHAT_PERSONA_MAP` and `CHAT_ROLE_DESCRIPTIONS` for
   `fine_tuning`: persona becomes `PERSONAS.qaEngineer`, description references the findings in
   `05_qa.md` (understand issues, prioritise, guide fixes) rather than "tweak execution output".
   Both maps are module-private consts consumed only by `chatPrompt`, which falls back to
   `softwareEngineer` — so a missing entry degrades silently rather than failing. Assert the entry
   exists in a test.

5. **`src/pipeline/handlers/qa.ts`** (new file):
   Imports mirror `execute.ts` exactly — same modules, same order. There is no `src/git/commit.ts`;
   git helpers live in `src/git/operations.ts`, and the codebase constructs its client with
   `createGit(cwd)`, never `simpleGit` directly. Skills resolve inside `runAndStream` from `stage`
   via `LAP_BY_STAGE`, so `qa.ts` does not import `skills.ts` and does not pass a `lap`.

   ```typescript
   import path from "path";
   import { existsSync, appendFileSync } from "node:fs";
   import type { TaskContext } from "../types.js";
   import { runAndStream } from "../../claude/session.js";
   import { qaPrompt } from "../../claude/prompts.js";
   import { commitAll, createGit } from "../../git/operations.js";
   import { updateStage } from "../../state/store.js";
   import { completionSection } from "../validation.js";
   import { log } from "../../utils/logger.js";

   const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write", "Bash"];
   const MAX_TURNS = 60; // QA runs a full build/lint/test cycle plus a diff read

   export async function handleQa(ctx: TaskContext): Promise<void> {
     const { prompt, persona } = qaPrompt(ctx);

     await runAndStream({
       prompt,
       persona,
       cwd: ctx.cwd,
       allowedTools: ALLOWED_TOOLS,
       stage: "ai_qa",
       taskPlanPath: ctx.planPath,
       plansDir: ctx.plansDir,   // required — see M3 task 7
       maxTurns: MAX_TURNS,
     });

     // Verify 05_qa.md was written before advancing. Advancing without it strands the task:
     // fine_tuning points at 05_qa.md, tryAdvance returns no_questions_file, and there is no
     // forward path.
     const qaPath = path.join(ctx.cwd, ctx.planPath, "05_qa.md");
     if (!existsSync(qaPath)) {
       throw new Error("QA session did not produce 05_qa.md");
     }

     appendFileSync(qaPath, completionSection("Cleanup"), "utf-8");

     updateStage(ctx.planPath, "fine_tuning");

     const git = createGit(ctx.cwd);
     const hash = await commitAll(git, `vibe-racer: QA review for #${ctx.taskNumber}`, ctx.cwd);
     if (hash) log.success(`Committed: ${hash}`);

     log.info("Review QA findings in 05_qa.md, then tick the checkbox.");
   }
   ```
   Note `plansDir` and `maxTurns` — both were missing from the original sample. Without `plansDir`
   this handler silently falls back to a default plans root and Rule 0 may protect the wrong tree.

   **On `MAX_TURNS = 60`:** this is a fresh judgement, not a copy of an existing value. `execute.ts`
   passes **no** `maxTurns` at all (`execute.ts:29-36`; the field is optional in `SessionOptions` and
   is left undefined), so there is nothing to "match". 60 is a starting point for a lap that runs
   build, lint, tests, and reads a diff — tune it if QA truncates, and record what you chose.

6. **`src/pipeline/handlers/execute.ts`** — Modify post-loop behavior:
   - Change the advancement target from `"fine_tuning"` to `"ai_qa"`
   - **Delete the checkbox-rewriting block entirely** (the `replace(/^-\s*\[x\]\s*Ready to advance to
     Execution\s*$/im, "- [ ] Ready to advance to Cleanup")` and its surrounding read/write).
     `04_execute.md` keeps its ticked `Ready to advance to Execution` marker, which is correct and
     harmless — `fine_tuning` no longer points at that file. QA appends its own checkbox to `05_qa.md`.
   - Add a hint after the commit: `Task #N is ready for QA — run 'vibe-racer drive' to start the QA lap.`

7. **`src/pipeline/machine.ts`** — Register `handleQa`:
   ```typescript
   import { handleQa } from "./handlers/qa.js";
   // ...
   "ai_qa": withErrorHandling("ai_qa", handleQa),
   ```

8. **`tests/fixtures/incomplete-task/`** (new — **this is AC2's evidence, do not skip it**).
   `03_plan_questions.md` Q2 committed to this fixture and it was dropped from an earlier task list.

   A bare pair of markdown files is **not** enough to run `handleQa` against: the handler needs a
   real `TaskContext`, `qaPrompt` loads `00_objective.md`, and the prompt's diff scope needs a git
   history to read. Build a fixture that satisfies all three:

   ```
   tests/fixtures/incomplete-task/
     README.md         # states that the gap below is intentional — for the next reader
     00_objective.md   # one-paragraph objective
     03_plan.md        # single milestone, one mechanically checkable AC:
                       #   "every exported function in src/sample.ts has a JSDoc block"
     04_execute.md     # that milestone marked `done`
     src/sample.ts     # TWO exported functions; the second has NO JSDoc  <- the seeded gap
   ```

   The criterion must be checkable by reading, not by running the suite — QA must catch it by
   inspection, which is the behaviour under test.

9. **Verify AC2 — the procedure, not just the fixture.** This is a scripted manual run, not a
   `vitest` case (it calls a real Claude session). Write it as `scripts/verify-ac2.mjs`, run it once,
   and paste the result into `04_execute.md`'s M5a Notes column:

   ```
   1. mkdtemp; git init; git commit --allow-empty -m base   (branch: main)
   2. copy fixture src/sample.ts WITHOUT the second function; commit on main
   3. git checkout -b vibe-racer/0001_fixture
      add the second, un-documented function; commit
      -> `git diff main...HEAD` now genuinely contains the seeded gap
   4. copy 00_objective.md / 03_plan.md / 04_execute.md into <tmp>/plans/0001_fixture/
      write state.yml { stage: ai_qa, title: "Fixture" }
      write a minimal .vibe-racer.yml (loadConfig needs it)
   5. build a TaskContext for that dir and call handleQa(ctx)
   6. assert 05_qa.md's "What doesn't" section names the missing JSDoc
   ```

   **Pass condition:** `05_qa.md` reports the seeded gap. **Fail condition:** it reports the fixture
   clean — in which case the prompt is not adversarial enough and **M5a is not done**. Record the
   verbatim finding either way; a pass with a vague finding ("documentation could be improved") is
   also a fail.

   Keep `scripts/verify-ac2.mjs` in the repo — AC2 is a property of the prompt, and the prompt will
   be edited again.

10. **`tests/pipeline/handlers/qa.test.ts`** (new file) — Tests:
   - `handleQa` calls `runAndStream` with stage `"ai_qa"`, the expected allowed tools,
     **and `plansDir: ctx.plansDir`**
   - Throws when `05_qa.md` is absent after the session, and does **not** advance the stage
   - Appends the completion checkbox on success
   - Advances to `fine_tuning`
   - Commit message contains "QA review"

11. **`tests/pipeline/handlers/execute.test.ts`** (**new file — none exists today**) — M5a changes
    this handler's terminal behaviour and nothing currently covers it:
    - Advances to `ai_qa`, not `fine_tuning`
    - Does **not** rewrite `04_execute.md`'s checkbox
    - Milestone loop exits when no `pending` rows remain

12. **`tests/pipeline/machine.test.ts`** (**EXTEND — 109 lines, not in the original file list**) —
    it `vi.mock`s each handler module and enumerates agent stages in a "handler coverage" block.
    Add a `vi.mock` for `./handlers/qa.js`, a routing test for `ai_qa`, and an `ai_qa` line in the
    coverage test. Without this the new stage has no routing coverage at all.

13. **`tests/pipeline/states.test.ts`** — Add the `STAGE_QUESTIONS_FILE[fine_tuning] === "05_qa.md"`
    assertion (the existing block asserts all six current mappings and will fail on the remap).

14. **`tests/claude/prompts.test.ts`** — Add `qaPrompt` tests: adversarial framing present, all six
    mandatory sections present, and the `git diff main...HEAD` scoping instruction present;
    `CHAT_PERSONA_MAP["fine_tuning"]` resolves to `PERSONAS.qaEngineer`.

### Test requirements

- New QA handler, execute handler, machine routing, and prompt tests pass
- Stage flow `ready_to_execute` → `ai_qa` → `fine_tuning` works end to end
- Build, lint, typecheck pass

---

## Milestone 5b: Decision Stage + Checklist Enforcement

### Goal

`handleDone` writes `06_decision.md` and parks at `need_decision`; `tryAdvance` refuses to close a
task with unticked checklist items.

### Existing code reused

- `src/pipeline/handlers/done.ts` — extend to write `06_decision.md`
- `src/pipeline/validation.ts` — add `validateDecisionChecklist()`
- `src/state/advancement.ts` — checklist check for `need_decision`
- `src/claude/prompts.ts` — `decisionPrompt()`, radio persona for `need_decision`
- `src/cli/drive.ts`, `src/cli/pitwall.ts`

### Tasks

1. **`src/claude/prompts.ts`** — Add `decisionPrompt(ctx: TaskContext): { prompt: string; persona: string }` (no `skills` parameter — see M5a task 2):
   - Persona: `"Release Manager"`
   - Loads `00_objective.md`, `03_plan.md`, `05_qa.md`
   - Writes `06_decision.md`: every item concretely checkable (what to look at, where, what "good"
     looks like) and traced to a source — the objective, an acceptance criterion, or a QA risk
   - **Prefer flat, top-level `- [ ]` items; avoid nesting.** This is a readability preference, not
     a correctness requirement — `validateDecisionChecklist` (task 4) matches leading whitespace, so
     an indented item **is** counted and **will** block advancement. (An earlier revision claimed the
     regex was line-start anchored and that nesting would silently escape enforcement. That was true
     of the original regex and is no longer true of task 4's. The flat-list preference stands on its
     own: a flat list is what an operator can actually work through.)

2. **`src/claude/prompts.ts`** — Add `need_decision` to `CHAT_PERSONA_MAP` (`PERSONAS.releaseManager`, added in M5a task 4) and
   `CHAT_ROLE_DESCRIPTIONS` (help work the post-deploy checklist, explain what to verify, advise on
   waiving an item).

3. **`src/pipeline/handlers/done.ts`** — Extend `handleDone`. The original plan specified this in
   four bullets with no session contract; it needs the same rigour as `handleQa`:

   ```
   1. Existing: the cleanup/docs session (unchanged)
   2. NEW: second runAndStream — the decision session:
        prompt/persona:  decisionPrompt(ctx)
        allowedTools:    ["Read", "Glob", "Grep", "Write"]      // no Bash, no Edit — it writes one file
        stage:           "cleanup_ready"                         // → lap "decision" via LAP_BY_STAGE
        taskPlanPath:    ctx.planPath
        plansDir:        ctx.plansDir
        maxTurns:        30
   3. NEW: verify 06_decision.md exists; throw if not (mirrors handleQa task 5)
   4. NEW: append completionSection("Done")
   5. CHANGED: updateStage(ctx.planPath, "need_decision")   // was "done"
   6. Commit: "vibe-racer: cleanup + decision checklist for #N"
   ```

   **The existence check is load-bearing.** `handleDone` currently advances unconditionally. If the
   decision session fails to write the file and the handler still advances, the task parks at
   `need_decision`, `tryAdvance` returns `no_questions_file`, and it is stranded with no forward path —
   the identical failure this plan already documents for `fine_tuning`. Throw instead, so
   `withErrorHandling` records `error_stage: cleanup_ready` and `--retry` can re-run the whole
   cleanup lap.

   **Note the guard profile.** `cleanup_ready` is deliberately *not* in `PLAN_JAILED_STAGES` — the
   cleanup session legitimately edits docs across the repo. That means the decision session inherits
   whole-repo write access to produce one file in the plan directory. Constraining `allowedTools` to
   `Write` (no `Edit`, no `Bash`) is the mitigation; jailing the stage is not an option without
   breaking the docs pass. Record this in `06_decision.md` (task 7).

   **Also note:** `handleDone` does **not** actually run build/lint/test. Those are prose lines in
   `donePrompt` (`prompts.ts:571-573`) with no verification that the model ran them. `01_product.md`
   describes the cleanup session as the "re-verification pass" behind `fine_tuning` — it is a
   suggestion to the model, not a gate. Do not tighten this here (out of scope), but do not rely on
   it either, and say so in `06_decision.md`.

4. **`src/pipeline/validation.ts`** — Add `validateDecisionChecklist()`:
   ```typescript
   export function validateDecisionChecklist(filePath: string): {
     valid: boolean;
     unchecked: Array<{ line: number; text: string }>;
   } {
     const content = readFileSync(filePath, "utf-8");
     const lines = content.split("\n");
     const unchecked: Array<{ line: number; text: string }> = [];
     for (let i = 0; i < lines.length; i++) {
       // Leading whitespace is matched on purpose: an indented "- [ ]" is still an unworked
       // item, and anchoring at column 0 would let a nested checklist close a task silently.
       if (/^\s*[-*]\s*\[\s\]/.test(lines[i])) {
         unchecked.push({ line: i + 1, text: lines[i].trim() });
       }
     }
     return { valid: unchecked.length === 0, unchecked };
   }
   ```
   `- [x]` never matches, so the completion marker is not counted — but assert that in a test rather
   than relying on it (`hasCompletionMarker` runs first and has already confirmed `[x]`).

5. **`src/state/advancement.ts`** — Add checklist enforcement, after the `validateAnswers` check and
   before the stage advance:
   ```typescript
   if (currentStage === "need_decision") {
     const checklist = validateDecisionChecklist(filePath);
     if (!checklist.valid) {
       removeCompletionMarker(filePath);
       log.warn(`Decision checklist has ${checklist.unchecked.length} unworked item(s):`);
       for (const item of checklist.unchecked) {
         log.warn(`  line ${item.line}: ${item.text}`);
       }
       return { advanced: false, reason: "incomplete_checklist" };
     }
   }
   ```
   Add `"incomplete_checklist"` to the `AdvancementResult.reason` union (the interface is
   module-private, so no export changes needed).

6. **`src/cli/drive.ts` / `src/cli/pitwall.ts`** — The `fine_tuning` and `need_decision` hints come
   from `STAGE_QUESTIONS_FILE` / `STAGE_NEXT_NAME` lookups already populated in M1 and M5a, so no
   new hint code is needed. `pitwall` groups via `isAgentStage`/`isHumanStage`, which derive from
   `AGENT_STAGES` — also already correct. **Verify, don't rewrite**: confirm no hardcoded stage list
   exists in either file, and cover both stages with tests.

7. **Record the accepted residual risks.** Three known gaps ship with this change, all deliberate.
   They must appear in this task's `06_decision.md`, and `03_plan.md`'s own "Accepted residual risks"
   section (below) is the source the decision prompt reads:
   - **Bash can still write `state.yml`** (M3 task 3). Rule 0 covers `Write`/`Edit` only.
   - **`settingSources: ["user"]` widens the trust boundary** (M4 spike finding 2) for one skill
     that no default mapping uses.
   - **Cleanup/decision sessions are not write-jailed** (task 3 above).

8. **`tests/pipeline/handlers/done.test.ts`** (**new file — none exists today**):
   - Runs a second session with stage `cleanup_ready` and the decision allowed-tools set
   - Throws when `06_decision.md` is absent, and does **not** advance the stage
   - Advances to `need_decision`, not `done`
   - Commit message contains "decision checklist"

9. **`tests/pipeline/validation.test.ts`** (**EXTEND — already exists, 260 lines**):
   - All ticked → `valid: true`
   - Some unticked → returns items with correct line numbers
   - `- [x] Ready to advance to Done` is not counted as unchecked
   - **An indented `  - [ ] sub-item` IS counted** (guards the anchoring fix)

10. **`tests/state/advancement.test.ts`** — `tryAdvance` at `need_decision` with unticked items
    returns `incomplete_checklist` and unchecks the completion marker; with all ticked, advances to
    `done`.

11. **`tests/cli/pitwall.test.ts`** — `ai_qa` renders under agent tasks, `need_decision` under human
    tasks.

    **`tests/cli/drive.test.ts`** — AC8 has two halves and only pitwall was covered. Add the hint
    path: at `fine_tuning`, `drive`'s waiting-on-human line names `05_qa.md` and "Ready to advance to
    Cleanup"; at `need_decision`, `06_decision.md` and "Ready to advance to Done". Both come from
    `STAGE_QUESTIONS_FILE` / `STAGE_NEXT_NAME` lookups, so this is a cheap test that catches a
    missing map entry.

12. **`tests/claude/prompts.test.ts`** — `decisionPrompt` references `06_decision.md`, asks for flat
    top-level checkboxes, and `CHAT_PERSONA_MAP["need_decision"]` resolves to `PERSONAS.releaseManager`.

13. **`tests/state/schema.test.ts`** — **backward compatibility.** The Test Strategy's Layer 2 names
    this and no task produced it. Add: a `state.yml` written by the *old* code — `stage: ready_to_execute`
    with `next: fine_tuning`, and an error record whose `error_stage` is a legacy handler name like
    `"design-review"` — still parses via `readState` without throwing. This is what protects the
    in-flight tasks in `plans/0001`–`0003`, and it is the constraint `00_objective.md` calls out by
    name.

### Test requirements

- All new handler, validation, advancement, and prompt tests pass
- Full stage flow: `ready_to_execute` → `ai_qa` → `fine_tuning` → `cleanup_ready` → `need_decision` → `done`
- Checklist enforcement blocks advancement when items are unticked
- Build, lint, typecheck pass

---

## Milestone 6: Docs + Cleanup

### Goal

Update all documentation to the seven-lap pipeline, update CHANGELOG, and delete `vibe-racer-fix.md`.

**The original file list could not satisfy its own acceptance criterion.** AC11 requires no stale
five-lap references anywhere; the list named seven files and there are stale references in five more,
one of which is a *source* file. The verified list is below — it comes from an actual grep, not a
guess.

### Tasks

1. **`README.md`** — four sites:
   - `:12` tagline → "Seven laps from objective to shipped code — you call the pit stops."
   - `:67` "Repeat through all five laps" → seven
   - `:69` "## The Five Laps" → "## The Seven Laps"
   - `:71` "races through 5 laps, producing 5 documents" → 7 and 7, update the diagram and the lap
     table (add Lap 6 QA / QA Engineer / QA report, Lap 7 Decision / Release Manager / post-deploy
     checklist)
   - Add `skills` to the configuration example

2. **`package.json:4`** — `description` field still says "five laps from objective to shipped code".
   This ships to npm.

3. **`src/cli/index.ts:27`** — `.description("Your AI race engineer — five laps from objective to
   shipped code")`. **A source file, in the docs milestone** — it is the string printed by
   `vibe-racer --help`, so it is documentation in every sense that matters. Run `npm run build` after.

4. **`docs/index.md`** — **four** sites: `:7` VitePress hero `tagline`, `:21` feature card title
   "Five Laps", `:62` prose "races tasks through five laps: objective, product, design, plan, and
   execution", and `:70` "A 5-lap pipeline that forces proper software development process…".
   (`:70` was missed by the earlier hyphen-blind grep — see Verification.)

5. **`docs/.vitepress/config.ts`** — two sites: `:5` site `description`, `:32` sidebar link text
   "The Five Laps".

6. **`docs/pipeline.md`** (158 lines) — `:1` "# The Five Laps", `:3` "through 5 laps, producing 5
   documents" and the document chain diagram. Add Lap 6 (QA) and Lap 7 (Decision) sections in the
   established pit-stop / race-engineer format. Document the power-user escape hatch: `state.yml` is
   denied to the *agent* by Rule 0 but remains the operator's file, so setting `stage: ai_qa` by hand
   re-runs QA after fixes.

7. **`docs/getting-started.md:80`** — "Repeat this cycle through all 5 laps".

8. **`docs/faq.md`** — two sites, and both are more than a word swap:
   - `:7` "A full 5-lap pipeline … typically costs $3-8 total" — the lap count *and* the cost
     estimate change; two more Claude sessions per task
   - `:61` describes `--retry` behaviour, which M3 changed. Rewrite: retry now restores the stage the
     task failed at and re-runs it from the top; a legacy error record prints an actionable message
     instead of crashing.

9. **`docs/how-it-works.md`** (115 lines) — the state machine description (`:30`), the `need_*`/`ai_*`
   stage explanation (`:38-39`), and the per-lap persona list (`:49`) all need the two new stages.

10. **`CLAUDE.md`** — no literal "five laps", but three stale statements:
    - `:39` per-lap personas — add QA Engineer and Release Manager
    - `:41` trivial fast-path — M2 changed how `trivial` is set (handler reads a file artifact; the
      agent no longer writes `state.yml`). The current wording implies the old mechanism.
    - Project structure block — add `qa.ts` under `pipeline/handlers` and `skills.ts` under `claude/`
    - Add a "state.yml is pipeline-owned, agents may not write it" line under Key decisions

11. **`docs/configuration.md`** — document the `skills` key: per-lap arrays, config replaces defaults
    (not additive), omitted laps use built-ins. State the shipped defaults (`execute: ["simplify"]`,
    `qa: ["security-review"]`, everything else empty) and give `claude-api` as a worked override
    example. **Do not describe `supportedCommands()` output as "your installed skills"** — it returns
    every slash command including harness commands like `compact` and `cost`, so a mistyped name can
    resolve silently instead of warning.

    **Include a "Where skills come from" subsection.** This is the question operators will actually
    have, and getting it wrong wastes their time:

    | Source | Reachable? | Notes |
    |---|---|---|
    | Bundled Claude Code skills | always | the only safe basis for built-in defaults |
    | `~/.claude/skills/<name>/SKILL.md` | yes, via `"user"` scope | the practical way to add your own |
    | `<host-project>/.claude/skills/` | yes, via `"project"` scope | per-project, ships with the repo |
    | User-scope plugins (`enabledPlugins`) | yes, if the plugin ships a `skills/` dir | many official plugins ship commands/agents only |
    | **claude.ai account / org skill catalogues** | **no** | Server-side, scoped to a Claude.ai workspace. Reachable from claude.ai, Cowork, and Tag — **not** from the CLI or Agent SDK. There is nothing to install locally. To use an equivalent in vibe-racer, re-author it as a local skill under `~/.claude/skills/`. |

12. **`docs/commands.md`** — two stale lines, both invalidated by earlier milestones:
    - `:82` `| --retry | Retry tasks in error state |` — M3 changed the behaviour; it now restores the
      stage the task failed at and re-dispatches, and reports actionably on a legacy `error_stage`
    - `:137` "Sets `state.yml` with `trivial: true` — skips product and design laps" — M2 moved that
      write from the agent to the handler; the agent now signals by writing `03_plan_questions.md`

    Also mention the post-execution QA hint in the `drive` description.

13. **`docs/security.md`** — add a `settingSources` subsection. R2 in this plan's residual-risks table
    names this file as where the widened trust boundary belongs, and it currently contains no mention
    of `settingSources` at all. State plainly: sessions load **user-scope** settings, which carry
    hooks, permissions, MCP servers, and `additionalDirectories` — not only skills — and run under
    `permissionMode: "bypassPermissions"` with `canUseTool` as the only enforcement layer. The README
    advertises a hardened security model; this change widens it and the docs must say so.

14. **`CHANGELOG.md`** — entry covering all three workstreams plus the `--retry` fix. Two items
    deserve explicit mention because they reverse or alter documented 0.2.0 behaviour:
    - `writeState` is re-exported from `state/store` (0.2.0's entry says "Un-exported 13 internal
      symbols across … `state/store`"; M2 task 3 puts one back, deliberately)
    - `SecretDetectedError` is now exported and rethrown from the error path, so a secret detected
      during partial-work commit aborts before `setError` records the stage (M3 task 10)

15. **Delete `vibe-racer-fix.md`** from the repo root (175 lines). Per `03_plan_questions.md` Q6 this
    happens here, not when the fixes land, so the QA lap in M5a can still cross-reference it.

### Verification

Not "read the docs carefully" — run the grep. It is the same one that found the gaps in this list:

```bash
grep -rniE '(five|5)[ -]laps?|(five|5) documents' \
  --include='*.md' --include='*.ts' --include='*.json' \
  --exclude-dir=node_modules --exclude-dir=plans --exclude-dir=dist \
  --exclude=CHANGELOG.md .
```

Before the milestone starts, this returns **16 hits across exactly 8 files** — `README.md` (4),
`docs/index.md` (4), `docs/.vitepress/config.ts` (2), `docs/pipeline.md` (2), `docs/faq.md` (1),
`docs/getting-started.md` (1), `package.json` (1), `src/cli/index.ts` (1). That is precisely the set
tasks 1-9 target. If your run shows a file not in that list, the docs drifted after this plan was
written — handle it, do not ignore it.

**Use `--exclude-dir`, not a `| grep -v` pipe.** An earlier revision filtered with
`| grep -v '^./plans/'`, which silently matched nothing: `grep -rn … .` emits paths as
`plans/foo.md`, not `./plans/foo.md`, so the anchor never fired and the exclusion was decorative.
The same mistake as the missing hyphen, in the same command — verification commands need verifying
too. Run it once before you start editing and confirm the 16/8 baseline above.

**The alternation on the separator is required, not cosmetic.** An earlier revision used
`'five lap|5 lap|five-lap|…'` — space-or-`five-`, but never `5-`. `docs/faq.md:7` reads
"A full **5-lap** pipeline", with a hyphen, so that pattern missed it and AC11 could have passed
with faq.md still stale. The file was in task 8 only because someone read it by hand — and running
the corrected pattern also surfaced `docs/index.md:70`, a fourth site in a file the plan claimed had
three.

**Two exclusions, both deliberate:**
- `plans/` — the objective, product, and design documents for this task legitimately discuss the
  five-lap *starting state*. Rewriting them would falsify the record of what was decided and why.
- `CHANGELOG.md` — its 0.1.0 entry reads "5-lap development pipeline: objective, product, design,
  plan, execute". That was true of 0.1.0. **A changelog is history; do not edit past entries.** The
  new seven-lap pipeline belongs in a *new* entry (task 14), not as a retroactive edit to an old one.

Must return **zero rows**.

### Test requirements

- The grep above returns nothing
- `vibe-racer-fix.md` no longer exists
- `npm run build` passes (the `src/cli/index.ts` change is compiled)
- `npm run lint` and `npm run test` pass
- `npm run docs:build` passes (VitePress config was edited)

---

## Accepted residual risks

Three known gaps ship with this change. All are deliberate, none are defects, and each must appear
as a named item in this task's `06_decision.md` (M5b task 7) so the operator signs off on them
knowingly rather than discovering them later.

| # | Risk | Why accepted | What would close it |
|---|---|---|---|
| R1 | **`Bash` can still write `state.yml`.** Rule 0 is gated on `PATH_TOOLS = {Read, Write, Edit, Glob, Grep}`, so `echo … > plans/NNNN/state.yml`, `sed -i`, and `tee` are untouched. `Bash` is in `allowedTools` at `ready_to_execute`, `ai_qa`, and `cleanup_ready`. | The incident in `vibe-racer-fix.md` was an agent using `Write`. No prompt instructs an agent to shell-write `state.yml`, and after M2 no prompt instructs it to write `state.yml` at all. Extending the Bash filter is a larger change to the command parser than this task should carry. | A `state.yml` write-pattern check in `checkBashCommand`. AC4 is scoped to `Write`/`Edit` and does **not** claim Bash coverage. |
| R2 | **`settingSources: ["project", "user"]` widens the trust boundary.** User-scope settings carry hooks, permissions, MCP servers, and `additionalDirectories` — not just skills — into every session, and sessions run `permissionMode: "bypassPermissions"` with `canUseTool` as the only enforcement. | Needed to reach locally-authored `~/.claude/skills/` (verified by canary: invisible under `["project"]`, visible under `["project","user"]`). **Note the objective's stated reason — reaching claude.ai account skills — is not achievable by any settings change**; those are server-side and unreachable from the SDK. Measured benefit on this machine today is one plugin skill (`frontend-design`) that no default uses, so the benefit is largely prospective. | Narrower SDK scoping for skills specifically, if the SDK ever offers it. Until then this is a documented property of running vibe-racer, and belongs in `docs/security.md`. |
| R3 | **The cleanup and decision sessions are not write-jailed.** `cleanup_ready` is not in `PLAN_JAILED_STAGES`, so the decision session has whole-repo write access to produce one file in the plan directory. | The cleanup session legitimately edits docs across the repo; jailing the stage would break the docs pass. Mitigated by giving the decision session `allowedTools: ["Read","Glob","Grep","Write"]` — no `Edit`, no `Bash`. | Splitting cleanup into two stages with different guard profiles. Out of scope. |

Related but not a risk of this change: **`handleDone` does not actually run build/lint/test.** They
are prose instructions in `donePrompt` with no verification. `01_product.md` treats the cleanup
session as the re-verification pass behind `fine_tuning`; it is a suggestion to the model, not a gate.
Worth stating plainly in `06_decision.md` so nobody leans on it.

---

## Dependency Graph

```
M1 (Schema)
├── M2 (Trivial Re-Plumb) ── depends on M1
│   └── M3 (Guard + Error) ── depends on M1, M2
├── M4 (Skills) ── depends on M1
│
└── M5a (QA + Execute Rewiring) ── depends on M1, M2, M3, M4
    └── M5b (Decision + Checklist) ── depends on M5a
        └── M6 (Docs) ── depends on M1-M5b
```

M2 and M4 are independent of each other but both depend on M1. M3 depends on M2. M5a depends on all
of M1-M4. **M5b depends on M5a specifically**, not merely on "M5" — `decisionPrompt` reads `05_qa.md`,
which does not exist until `handleQa` ships. M6 depends on M5b.

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

| AC | Milestone | Verification |
|---|---|---|
| AC1 | M5b | End-to-end task produces `00_objective.md` through `06_decision.md`, reaching `done` only after the decision checkbox is ticked |
| AC2 | M5a | Run `handleQa` against `tests/fixtures/incomplete-task/` (task 8) and confirm `05_qa.md` names the seeded unmet criterion under "What doesn't". **Record the finding verbatim in the M5a Notes column of `04_execute.md`** — this is the evidence, and it is the only AC that proves the QA lap is worth having. If QA reports the fixture as clean, the prompt has failed and M5a is not done. |
| AC3 | M5b | `06_decision.md` items trace to the objective, the plan's acceptance criteria, and QA risks — including residual risks R1–R3 |
| AC4 | M3 | Guard denies `Write`/`Edit` to `state.yml` at a review stage, an execution stage, and `ai_qa`; denials land in `.vibe-racer/audit.log`. **Scoped to `Write`/`Edit`** — Bash is residual risk R1, not a gap. |
| AC5 | M3 | `setError` on a corrupt `state.yml` writes a valid error record and does not throw, including when validate-on-write would reject the salvaged object |
| AC6 | M2 | Trivial task classifies correctly without the agent writing `state.yml` |
| AC7 | M4 | A configured skill appears in the relevant lap's prompt **for every lap, not just QA** — verified via `LAP_BY_STAGE` coverage. A missing skill warns and the lap still completes. |
| AC8 | M5b | `pitwall` renders both new stages; `drive` names the right file and checkbox for each |
| AC9 | M5b | `tryAdvance` at `need_decision` rejects an unticked checklist, including indented items |
| AC10 | M3 | `--retry` restores the failed stage and dispatches exactly once; a legacy `error_stage` produces an actionable message rather than `No handler for state: error` |
| AC11 | M6 | The stale-reference grep returns zero rows; `vibe-racer-fix.md` deleted |

### Continuous Verification

Every milestone ends with:
```bash
npm run build && npm run typecheck && npm run test && npm run lint
```

Baseline at the start of this task: **27 test files, 336 tests, all passing.** Test count must only
go up. A milestone that leaves the suite green by deleting or skipping coverage is not done.
