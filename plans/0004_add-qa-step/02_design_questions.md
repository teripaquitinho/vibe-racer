# Design Questions for #4: Add QA step

> **Role**: Senior Software Architect
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-08-24

---

## Stage insertion and guard treatment

### Q1: How should `ai_qa` be classified in the guard system — new category, or augmented review stage?

`ai_qa` needs plan-directory write jailing, like the review stages, and also needs `Bash` to run tests.

An earlier reading of this had the mechanism wrong, so state it precisely: **`REVIEW_STAGES` does not gate Bash at all.** The guard's only stage-conditional rule is the Write/Edit path jail (Rule 4, `guard.ts`). Bash is kept out of review stages by each handler's `ALLOWED_TOOLS` — `review-runner.ts` omits it — and `formatGuardSummary` merely *prints* `bash: blocked (review stage)`, a cosmetic string with no enforcement behind it. `ai_qa` could therefore join `REVIEW_STAGES` unchanged and still run Bash; the only casualty would be that summary line lying.

So the real question is not how to work around a constraint that does not exist. It is whether Bash should stay gated by `allowedTools` alone, or become explicit in the guard as well.

**Answer:**
Split `REVIEW_STAGES` into two orthogonal sets: `PLAN_JAILED_STAGES` (file writes restricted to the plan directory) and `BASH_BLOCKED_STAGES` (stages that may not run Bash). `ai_qa` joins the first, not the second. The existing four review stages join both.

Be clear about what this changes. `PLAN_JAILED_STAGES` is a pure rename of today's behavior. `BASH_BLOCKED_STAGES` is **new enforcement** — a second, independent check on something currently guarded only by each handler's `allowedTools` list. Adopt it deliberately as defense in depth, not as a no-op refactor: it means a future handler that adds `Bash` to a review stage's tool list gets denied by the guard rather than silently gaining shell access. That is the behavior we want, but it is a change, and the plan lap should test it as one.

`formatGuardSummary` then reads from both sets instead of `REVIEW_STAGES`, so it reports accurate tool availability per stage rather than the current fixed string.

---

### Q2: Where in `STAGE_ORDER` and the handler dispatch map do `ai_qa` and `need_decision` land, and what is the handler module structure?

The product spec defines the logical position. The architecture question is whether QA gets its own handler file (`qa.ts`) or is folded into an existing handler, and how `need_decision` integrates with the existing `done` transition.

**Answer:**
Create `src/pipeline/handlers/qa.ts` for `ai_qa` — it has its own prompt, its own guard profile, and its own output file, so it deserves its own handler. `need_decision` is a pit-stop stage (the human ticks a checkbox), so it needs no handler file at all: it uses the same `tryAdvance` path as every other `need_*` stage, plus the checklist rule in `validation.ts`.

Three concrete wiring changes, in the right files:

1. **`src/pipeline/machine.ts`** — the dispatch map is `HANDLERS` here, not in `drive.ts`; `drive.ts` only calls `dispatch()`. Add one entry, wrapped like its neighbors: `ai_qa: withErrorHandling("ai_qa", handleQa)`. No entry for `need_decision` — human stages are never dispatched.
2. **`src/pipeline/handlers/execute.ts`** — `handleExecute` currently ends with `updateStage(ctx.planPath, "fine_tuning")`. It now advances to `ai_qa`, and stops rewriting the completion checkbox in `04_execute.md`, since that checkbox moves to `05_qa.md`.
3. **`src/pipeline/handlers/done.ts`** — `handleDone` (registered for `cleanup_ready`) is extended to write `06_decision.md` after its existing docs pass and build/lint/test, and its final `updateStage(ctx.planPath, "done")` becomes `updateStage(ctx.planPath, "need_decision")`. The task now reaches `done` only through `tryAdvance`, when the operator ticks the decision checkbox.

---

## Checklist enforcement

### Q3: How should `validation.ts` enforce the "all checkboxes ticked" rule for `need_decision` without affecting other stages?

`tryAdvance` currently checks two things: the completion marker checkbox and that all `**Answer:**` blocks are filled. For `need_decision`, it must additionally verify that every `- [ ]` in `06_decision.md` is ticked. This rule should only apply to the decision stage, and it needs to distinguish the completion marker checkbox from the checklist items above it.

**Answer:**
Add a `validateDecisionChecklist(filePath: string)` function in `validation.ts` that scans for unchecked `- [ ]` lines and returns the count plus the item text. Call it from `tryAdvance` only when the current stage is `need_decision`, so no other stage's behavior changes.

Two details the implementation has to get right:

- **The completion marker needs no special-casing.** `tryAdvance` only reaches this check after `hasCompletionMarker` has confirmed the marker is `- [x]`, so it is not an unchecked line and will not be counted. Do not add exclusion logic for it — that would be dead code, and it would break silently if the call order ever changed. Assert the ordering in a test instead.
- **Follow the existing failure convention.** Every other stage that fails validation calls `removeCompletionMarker` to untick the box, warns, and returns without advancing (`advancement.ts`, the `incomplete_answers` path). The decision check does the same: untick, warn with the count and text of the unticked items, return `{ advanced: false, reason: "incomplete_checklist" }`. This forces a deliberate re-tick once the operator finishes the checklist, rather than leaving a ticked box sitting above unfinished work.

---

## Prompt design

### Q4: How should the QA prompt be structured to produce honest negative findings rather than agreeable summaries?

The product spec identifies this as a first-class prompt-design problem. The model's default behavior is to be agreeable and summarize positively. The QA prompt needs to actively counteract this. The architecture question is what prompt techniques and structural constraints to use.

**Answer:**
Structure the QA prompt with three mechanisms: (1) **Mandatory sections** — the prompt requires `05_qa.md` to have all six sections (What works, What doesn't, What regressed, Deviations, Risks, Verification run) and states that empty "What doesn't" or "What regressed" sections must contain an explicit `No issues found — verified by [specific evidence]` rather than being omitted. (2) **Adversarial framing** — the persona is a QA engineer whose job performance is measured by finding real issues, not by confirming the build passes. The prompt should say: "A QA report that finds nothing wrong is a red flag, not a success — it means you didn't look hard enough or you're being agreeable." (3) **Evidence requirement** — every claim (positive or negative) must include the command run and its output. No summarizing test results; paste them. This makes it mechanically harder to fabricate a clean report. The prompt loads `03_plan.md` for acceptance criteria and `04_execute.md` for what was claimed done, so the QA session cross-references claims against evidence.

---

## Skills integration

### Q5: How should per-lap skill configuration flow from `.vibe-racer.yml` through the session builder to the prompt?

Skills need to be (a) read from config with per-lap defaults, (b) validated against what's actually installed, (c) injected into the prompt, and (d) degraded gracefully when missing. The architecture question is where each of these steps lives and how they compose.

**Answer:**
Add a `src/claude/skills.ts` module with two exports: `resolveSkills(lap, config)`, which merges built-in defaults with per-lap config overrides, and `partitionSkills(names, installed)`, which splits requested names into `{ available, missing }`.

**Discovery is a real API — do not guess at it.** Verified against `@anthropic-ai/claude-agent-sdk@0.2.101`:

- `supportedCommands(): Promise<SlashCommand[]>` on the query object is documented as "Get the list of available skills for the current session," returning `{ name, description, argumentHint }`. That is both the installed-skills list and the one-line descriptions the prompt wants, from a single call. No try-it-and-catch-the-failure fallback is needed.
- `SettingSource = 'user' | 'project' | 'local'`, so changing `settingSources` from `["project"]` to `["project", "user"]` is valid, and is what makes account-level skills resolvable in the first place.
- There is also a `skills?: string[]` option — "Array of skill names to preload into the agent context" — but it lives on `AgentDefinition`, **not** on the top-level `Options` that `session.ts` passes to `query()`. It is therefore unreachable from the current one-query-per-lap design. Flagged because it is the more direct mechanism if vibe-racer ever moves to defining agents; adopting it now would mean restructuring `runAndStream`, which is out of scope here.

Given that, the flow is: `session.ts` resolves the lap's skills, calls `supportedCommands()` for what is actually installed, partitions the two, logs one warning line naming any missing skills, and passes `available` to the prompt builder. `prompts.ts` appends an "Available engineering skills" section to the system prompt, listing each name with the description returned by `supportedCommands()` — descriptions come from the SDK, so they cannot drift from what the skill actually does. `Skill` is added to every handler's `ALLOWED_TOOLS`. The guard gets an explicit allow branch for `Skill` rather than falling through to default-allow, so the decision is recorded in code rather than inherited by accident.

A lap whose `available` list is empty runs on its persona alone, exactly as it does today.

---

## Trivial fast-path re-plumbing

### Q6: What artifact should the agent produce to signal triviality, and how does the handler detect and act on it?

The guard now denies agent writes to `state.yml`, so the current mechanism (agent writes `trivial: true` to `state.yml`) is dead. The objective notes that writing `03_plan_questions.md` instead of `01_product_questions.md` is already an unambiguous signal. The architecture question is whether to use this file-presence signal or something else, and how `objective-review.ts` detects it.

**Answer:**
Use file presence as the signal. The objective-review prompt instructs the agent: "If you determine this task is trivial, write `03_plan_questions.md` directly instead of `01_product_questions.md`." After the session completes, `objective-review.ts` checks which file was created. If `03_plan_questions.md` exists and `01_product_questions.md` does not, the handler calls `writeState({ ...state, trivial: true })` and advances to `need_plan` instead of `need_product`. This is already how the handler infers the agent's intent — it just moves the `trivial: true` write from the agent to the handler. No new artifact format, no new protocol. The prompt change is minimal: remove the "write state.yml" instruction, keep the "write 03_plan_questions.md" instruction.

---

## Error recovery

### Q7: How should `drive --retry` recover a failed task, given that it does not work today?

`--retry` is broken, and Workstream C makes it load-bearing: it is the documented recovery path for a failed QA or cleanup session. Today `--retry` only widens `drive`'s eligibility filter to tasks whose stage is `error`, then calls `dispatch("error", ctx)` — and `HANDLERS` has no `error` key, so it throws `No handler for state: error`. The obvious repair, reading the stage back out of `state.yml`, does not work either: `withErrorHandling` passes `setError` a *handler name* (`"execute"`, `"design-review"`, `"done"`), and `writeState` only copies `error_stage` into `prev` when it is a valid `Stage`, which a handler name never is. So `prev` is `null` on every error record ever written. The question is where to record the stage and how retry restores it.

**Answer:**
Record the stage, not the handler name, and restore it before dispatching.

1. **`machine.ts`** already keys `HANDLERS` by stage, so pass that key into the wrapper: `withErrorHandling("ai_qa", handleQa)` instead of a display name. Every existing registration changes the same way — `"objective-review"` becomes `"ai_objective_review"`, `"done"` becomes `"cleanup_ready"`. Today's names are not even 1:1 with stages (`handleDone` is registered as `"done"` but serves `cleanup_ready`), which is exactly the ambiguity this removes. If the log line `Handler [objective-review] failed` is worth keeping readable, take a second display-name argument rather than overloading the first.
2. **`schema.ts`** — leave `error_stage` as `z.string().optional()`. Do **not** tighten it to `z.enum(STAGES)`: error records written by earlier versions hold handler names, and tightening would make those files unparseable. `readState` throws, `discoverTasks` silently skips the folder, and `pitwall` loses the task entirely — a worse failure than the one being fixed.
3. **`store.ts`** — with a real stage in `error_stage`, the existing `writeState` branch populates `prev` correctly with no change.
4. **`drive.ts`** — when `--retry` selects a task in `error`, read `error_stage`, check membership in `STAGES`, call `updateStage(planPath, errorStage)`, then dispatch that stage. If `error_stage` is absent or invalid — a pre-fix record — print the recorded value and tell the operator to set `stage:` in `state.yml` by hand. Never fall through to `dispatch("error", ...)`.

Recovery re-runs the failed stage from the top. There is no mid-stage resume, and none is needed: `handleExecute`'s milestone loop already resumes correctly on its own, because it re-reads `04_execute.md` and skips milestones already marked `done`.

Regression tests: `dispatch` is never called with `"error"`; `--retry` on a task whose `error_stage` is `ai_qa` restores `stage: ai_qa` and dispatches `handleQa`; `--retry` on a record holding a legacy handler name produces an actionable message rather than a throw; and a `state.yml` carrying a legacy `error_stage` still parses and still renders in `pitwall`.

---

# Complete

- [x] Ready to advance to Design Review
