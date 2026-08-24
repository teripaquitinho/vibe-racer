# Design Specification: Add QA Step (#4)

> **Stage**: `ai_design_review`
> **Date**: 2026-08-24

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project / Directory Structure](#project--directory-structure)
3. [State Machine Changes](#state-machine-changes)
4. [Guard System Redesign](#guard-system-redesign)
5. [QA Handler](#qa-handler)
6. [Decision Stage and Checklist Enforcement](#decision-stage-and-checklist-enforcement)
7. [Skills Integration](#skills-integration)
8. [Trivial Fast-Path Re-Plumbing](#trivial-fast-path-re-plumbing)
9. [Error Recovery (`--retry`)](#error-recovery---retry)
10. [State Management Changes](#state-management-changes)
11. [Prompt Design](#prompt-design)
12. [Radio Personas](#radio-personas)
13. [Configuration Changes](#configuration-changes)
14. [Data Flow](#data-flow)
15. [Testing Strategy](#testing-strategy)
16. [Dependency Summary](#dependency-summary)

---

## Architecture Overview

Three workstreams converge on the same core modules. The design decomposes them into isolated changes that can be tested independently but must ship together.

```
                        Workstream A                Workstream B              Workstream C
                   (state.yml protection)        (engineering skills)       (QA + decision)
                          |                            |                         |
                          v                            v                         v
                   +-----------+                +-----------+            +---------------+
                   | guard.ts  |<-- new Rule 0 -| session.ts|<- skills ->| qa.ts (NEW)   |
                   | (split    |   state.yml    | settings  |  in prompt | done.ts (ext) |
                   |  stages)  |   deny rule    | Sources   |            | states.ts     |
                   +-----------+                +-----------+            +---------------+
                        |                            |                         |
                        v                            v                         v
                   +-----------+                +-----------+            +---------------+
                   | store.ts  |                | prompts.ts|            | validation.ts |
                   | setError  |                | skills    |            | checklist     |
                   | validate  |                | section   |            | enforcement   |
                   +-----------+                +-----------+            +---------------+
                        |                            |                         |
                        +----------------------------+-------------------------+
                                                     |
                                              +-------------+
                                              | schema.ts   |
                                              | (16 stages) |
                                              +-------------+
```

**Key architectural decisions** (traced to Q&A):

| Decision | Source | Rationale |
|---|---|---|
| Split `REVIEW_STAGES` into `PLAN_JAILED_STAGES` + `BASH_BLOCKED_STAGES` | Q1 | `ai_qa` needs write jailing but also needs Bash |
| `qa.ts` is a standalone handler; `need_decision` has no handler | Q2 | QA has unique prompt/guard/output; decision is a pure pit-stop |
| Checklist enforcement scoped to `need_decision` only | Q3 | Reuses existing `removeCompletionMarker` pattern, no other stage affected |
| QA prompt uses adversarial framing + mandatory sections + evidence | Q4 | Counteracts model agreeableness; structural constraints over instructions |
| Skills resolved via `supportedCommands()` API, injected into prompts | Q5 | Real API, not guesswork; descriptions come from SDK |
| Trivial signal via file presence (`03_plan_questions.md`) | Q6 | Handler reads artifact, calls `writeState` — agent never touches `state.yml` |
| `--retry` records stage (not handler name), restores before dispatch | Q7 | Fixes broken recovery; backward-compatible with legacy `error_stage` values |

---

## Project / Directory Structure

New and modified files:

```
src/
  claude/
    guard.ts              # MODIFIED — new Rule 0, split REVIEW_STAGES
    prompts.ts            # MODIFIED — QA prompt, decision prompt, skills section, radio personas
    session.ts            # MODIFIED — settingSources, Skill in allowedTools
    skills.ts             # NEW — resolveSkills(), partitionSkills()
  config/
    schema.ts             # MODIFIED — add skills key to VibeRacerConfig
  pipeline/
    handlers/
      qa.ts               # NEW — handleQa
      done.ts             # MODIFIED — write 06_decision.md, advance to need_decision
      execute.ts          # MODIFIED — advance to ai_qa, stop rewriting checkbox
      objective-review.ts # MODIFIED — trivial fast-path re-plumb
      safe-wrapper.ts     # MODIFIED — pass stage instead of handler name
    machine.ts            # MODIFIED — register handleQa, fix withErrorHandling args
    states.ts             # MODIFIED — PLAN_JAILED_STAGES, BASH_BLOCKED_STAGES, new stage entries
    validation.ts         # MODIFIED — validateDecisionChecklist()
  state/
    schema.ts             # MODIFIED — 2 new stages in STAGES enum
    store.ts              # MODIFIED — setError hardening, validate-on-write
    advancement.ts        # MODIFIED — checklist check for need_decision
  cli/
    drive.ts              # MODIFIED — --retry logic, post-execution hint
    pitwall.ts            # MODIFIED — render new stages
plans/
  (per task)/
    05_qa.md              # NEW (generated) — QA report
    06_decision.md        # NEW (generated) — post-deploy checklist
```

---

## State Machine Changes

### Stage Enum Extension

`src/state/schema.ts` — `STAGES` grows from 14 to 16 entries:

```typescript
const STAGES = [
  "need_objective",
  "ai_objective_review",
  "need_product",
  "ai_product_review",
  "need_design",
  "ai_design_review",
  "need_plan",
  "ai_plan_review",
  "need_execution",
  "ready_to_execute",
  "ai_qa",              // NEW
  "fine_tuning",
  "cleanup_ready",
  "need_decision",      // NEW
  "done",
  "error",
] as const;
```

`STAGE_ORDER` (excludes `error`) grows from 13 to 15 entries.

### New Entries in Stage Maps

`src/pipeline/states.ts`:

```typescript
// STAGE_QUESTIONS_FILE — maps pit-stop stages to their markdown file
STAGE_QUESTIONS_FILE["fine_tuning"] = "05_qa.md";       // CHANGED from 04_execute.md
STAGE_QUESTIONS_FILE["need_decision"] = "06_decision.md"; // NEW

// STAGE_NEXT_NAME — human-readable next stage for checkbox text.
// Only read by drive.ts when hinting at HUMAN stages, so agent-stage
// entries would be inert. Add the one that is actually reachable.
STAGE_NEXT_NAME["fine_tuning"] = "Cleanup";          // unchanged
STAGE_NEXT_NAME["need_decision"] = "Done";           // NEW

// AGENT_STAGES — add ai_qa
AGENT_STAGES.add("ai_qa");
```

### Regression Guard

The existing test `nextStage("need_plan") === "ai_plan_review"` must still pass. New tests:

- `nextStage("ready_to_execute") === "ai_qa"`
- `nextStage("ai_qa") === "fine_tuning"`
- `nextStage("cleanup_ready") === "need_decision"`
- `nextStage("need_decision") === "done"`

---

## Guard System Redesign

### Split `REVIEW_STAGES` (from Q1)

`src/claude/guard.ts`:

```
Before:
  REVIEW_STAGES = Set("ai_objective_review", "ai_product_review",
                      "ai_design_review", "ai_plan_review")
  Rule 4: if REVIEW_STAGES.has(stage) && tool is Write/Edit → jail to plan dir

After:
  PLAN_JAILED_STAGES = Set("ai_objective_review", "ai_product_review",
                           "ai_design_review", "ai_plan_review", "ai_qa")
  BASH_BLOCKED_STAGES = Set("ai_objective_review", "ai_product_review",
                            "ai_design_review", "ai_plan_review")

  Rule 4a: if PLAN_JAILED_STAGES.has(stage) && Write/Edit → jail to plan dir
  Rule 4b: if BASH_BLOCKED_STAGES.has(stage) && Bash → deny
```

`BASH_BLOCKED_STAGES` is **new enforcement** — today Bash is blocked by `allowedTools` alone. This is defense in depth: a future handler that adds `Bash` to a review stage's tool list gets denied by the guard rather than silently gaining shell access.

### New Rule 0: Deny Agent Writes to `state.yml`

Inserted **before** all existing rules, after path resolution:

```
Rule 0: if Write/Edit
        && basename(resolved) === "state.yml"
        && resolved is inside <cwd>/<plans_dir>/
        → deny + audit log
```

Applies at every stage — review, execution, QA, cleanup. This is the load-bearing fix for the corruption bug.

**Scope it to the plans directory.** Matching on basename alone would deny writes to any file named `state.yml` anywhere in the project, at every stage including execution — so a host project that happens to keep its own `state.yml` could not have it written by the execute lap. The file this rule protects is the pipeline-owned one under `plans_dir`; nothing outside that tree is the pipeline's business.

This means the guard needs `plans_dir` in `GuardOptions`. `taskPlanPath` is already passed in and is `<plans_dir>/NNNN_slug`, so the plans root can be derived from it — but pass it explicitly rather than inferring by string surgery.

### Explicit `Skill` Allow

Add `Skill` to the guard's known-tool handling. Rather than falling through to default-allow, the guard explicitly allows `Skill` calls, making the decision visible in code.

### Updated `formatGuardSummary`

Reads from `PLAN_JAILED_STAGES` and `BASH_BLOCKED_STAGES` to report accurate tool availability per stage, replacing the old hardcoded `bash: blocked (review stage)` string.

---

## QA Handler

### Module: `src/pipeline/handlers/qa.ts`

**Exports:** `handleQa(ctx: TaskContext): Promise<void>`

**Flow:**

```
handleQa(ctx)
  1. Load plan context:
     - Read 00_objective.md (intent)
     - Read 03_plan.md (acceptance criteria)
     - Read 04_execute.md (what was claimed done)
  2. Resolve skills for "qa" lap
  3. Build QA prompt (see Prompt Design section)
  4. Run Claude session:
     - allowedTools: ["Read", "Glob", "Grep", "Write", "Bash"]
     - stage: "ai_qa" (triggers plan-dir write jail, Bash allowed)
     - maxTurns: same as execution
  5. Verify 05_qa.md was written
  6. Append completion checkbox: "- [ ] Ready to advance to Cleanup"
  7. updateStage(ctx.planPath, "fine_tuning")
  8. Commit: "vibe-racer: QA review for #N"
  9. Print hint: "Review QA findings in 05_qa.md, then tick the checkbox."
```

**Guard profile:** `ai_qa` is in `PLAN_JAILED_STAGES` (write-jailed) but not in `BASH_BLOCKED_STAGES` (Bash allowed). This means QA can run tests and build commands but cannot write outside the plan directory. QA must not fix what it is judging.

**Does NOT reuse `review-runner.ts`:** The review runner is built for the question-answer-followup loop pattern. QA is a single-pass assessment — no follow-up rounds, no `**Answer:**` validation, no revert flow.

---

## Decision Stage and Checklist Enforcement

### `06_decision.md` Generation (from Q3)

`src/pipeline/handlers/done.ts` — extended to write `06_decision.md` after its existing docs pass and build/lint/test:

```
handleDone(ctx) — extended flow:
  1. Existing: docs pass, build, lint, test
  2. NEW: Build decision prompt from 00_objective.md + 03_plan.md + 05_qa.md
  3. NEW: Run Claude session to write 06_decision.md
  4. NEW: Append completion checkbox: "- [ ] Ready to advance to Done"
  5. CHANGED: updateStage(ctx.planPath, "need_decision")  // was "done"
  6. Commit: "vibe-racer: cleanup + decision checklist for #N"
```

### Checklist Validation (from Q3)

`src/pipeline/validation.ts` — new function:

```typescript
function validateDecisionChecklist(filePath: string): {
  valid: boolean;
  unchecked: Array<{ line: number; text: string }>;
}
```

Scans for `- [ ]` lines in `06_decision.md` and returns the count plus item text. Called from `tryAdvance` only when stage is `need_decision`.

**Integration in `src/state/advancement.ts`:**

```
tryAdvance(planPath, stage)
  1. Existing: hasCompletionMarker(file) — confirms "- [x] Ready to advance"
  2. Existing: validateAnswers(file) — checks **Answer:** blocks
  3. NEW (need_decision only): validateDecisionChecklist(file)
     - If unchecked items: removeCompletionMarker, warn with item text,
       return { advanced: false, reason: "incomplete_checklist" }
  4. Existing: advance stage
```

**No special-casing of the completion marker:** By the time `validateDecisionChecklist` runs, `hasCompletionMarker` has already confirmed `- [x]`, so the completion checkbox is not a `- [ ]` line. The ordering must be tested, not relied upon implicitly.

---

## Skills Integration

### New Module: `src/claude/skills.ts`

```typescript
// Built-in defaults — initially empty arrays, populated after
// account skill discovery during the plan lap
const DEFAULT_SKILLS: Record<string, string[]> = {
  objective: [],
  product: [],
  design: [],
  plan: [],
  execute: [],
  qa: [],
  decision: [],
};

function resolveSkills(
  lap: string,
  config: VibeRacerConfig
): string[]
// Merges DEFAULT_SKILLS[lap] with config.skills?.[lap] ?? []
// Config overrides defaults entirely (not additive)

function partitionSkills(
  requested: string[],
  installed: SlashCommand[]
): { available: SlashCommand[]; missing: string[] }
// Splits requested names against installed skills
// Returns full SlashCommand objects for available (includes description)
```

### Session Changes (`src/claude/session.ts`)

```
Before: settingSources: ["project"]
After:  settingSources: ["project", "user"]
```

This makes account-level skills resolvable. The `"user"` source includes `~/.claude/settings.json` where account skills resolve from.

**Skill discovery in `runAndStream` — the ordering constraint:**

`supportedCommands()` is declared on `Query` (`sdk.d.ts`: `interface Query extends AsyncGenerator<SDKMessage, void>`), which is the object `query()` *returns*. The prompt and `allowedTools` are *inputs* to `query()`. So skills cannot be discovered before building the session whose prompt lists them: the naive "discover, then build the prompt from the result" flow is circular. `runAndStream` also discards the Query object today (`for await (const message of query({...}))`), so it must retain the reference regardless.

Resolve it with a **probe query**: one short-lived `query()` whose only purpose is enumeration, closed before the real session opens.

```
runAndStream(options)
  1. requested = resolveSkills(lap, config)
  2. if requested.length === 0 → skip to step 7   (no probe, no cost)
  3. probe = query({ prompt: "", options: { cwd, settingSources, maxTurns: 0 } })
  4. installed = await probe.supportedCommands()
  5. await probe.return()                 // close before the real session opens
  6. { available, missing } = partitionSkills(requested, installed)
     log one warning line naming missing[]
  7. build system prompt, appending buildSkillsSection(available) when non-empty
  8. query({ prompt, options: { allowedTools: [...tools, "Skill"], canUseTool, ... } })
```

The probe costs one extra process spawn per lap, and only when the lap requests skills — a lap with an empty skill list never pays it.

**This must be verified empirically before milestone 4 begins.** `supportedCommands()` may require an initialized session rather than a freshly constructed query, in which case the probe returns nothing useful. Two fallbacks, in order of preference:

- **Streaming input mode.** Create the query first, call `supportedCommands()`, then push the real prompt as the first user message. No extra spawn, and pre-validation survives — but it restructures `runAndStream` from a single `query({ prompt })` call into a streaming-input session.
- **Skip pre-validation.** Always pass `Skill` in `allowedTools`, list the configured names in the prompt, and let an unknown skill fail at invocation. The lap still completes, but AC7's warn-at-load is forfeited and degradation becomes silent.

Prefer the streaming-input fallback over the silent one: AC7 requires a warning, not just survival.

A lap with zero available skills runs on its persona alone — identical to current behavior.

### Prompt Integration (`src/claude/prompts.ts`)

Every prompt function gains an optional `skills` parameter:

```typescript
function buildSkillsSection(skills: SlashCommand[]): string
// Returns:
// ## Available Engineering Skills
//
// You have access to the following engineering skills via the `Skill` tool:
//
// - **skill-name**: description (from SDK)
// - ...
//
// Use these skills when they are relevant to your work in this lap.
```

Appended to the system prompt when `skills.length > 0`. Descriptions come from `supportedCommands()`, so they cannot drift from what the skill actually does.

### Guard Treatment

`Skill` gets an explicit allow branch in `canUseTool`:

```typescript
if (toolName === "Skill") return { behavior: "allow" };
```

Placed alongside other known-tool checks. The decision is recorded in code rather than inherited by the default-allow fallthrough.

---

## Trivial Fast-Path Re-Plumbing

### From Q6: File Presence as Signal

**Current flow (broken once guard lands):**
1. Agent writes `trivial: true` to `state.yml` ← guard will deny this
2. Handler reads `state.yml`, sees `trivial: true`

**New flow:**
1. Prompt instructs: "If trivial, write `03_plan_questions.md` directly instead of `01_product_questions.md`"
2. Agent writes `03_plan_questions.md` (allowed — it is inside the plan directory)
3. `objective-review.ts` handler checks after session completes:
   ```
   if (exists(03_plan_questions.md) && !exists(01_product_questions.md)):
     writeState({ ...state, trivial: true })
     advance to need_plan
   else:
     advance to need_product (normal flow)
   ```
4. Prompt text: remove the "write state.yml" instruction, keep the "write `03_plan_questions.md`" instruction

The `trivial: true` write moves from agent to handler. The artifact-based signal is already unambiguous.

---

## Error Recovery (`--retry`)

### From Q7: Record Stage, Not Handler Name

**`src/pipeline/handlers/safe-wrapper.ts`:**

```
Before: withErrorHandling("objective-review", handleObjectiveReview)
After:  withErrorHandling("ai_objective_review", handleObjectiveReview)
```

Every registration changes: the first argument becomes the stage key (which is also the `HANDLERS` map key), not a display name. If human-readable logging is desired, take a second argument:

```typescript
function withErrorHandling(
  stage: Stage,                    // stored in error_stage
  handler: HandlerFn,
  displayName?: string             // for log messages only
): HandlerFn
```

**`src/state/schema.ts`:**

`error_stage` stays as `z.string().optional()` — **not** tightened to `z.enum(STAGES)`. Legacy error records hold handler names like `"objective-review"`, and tightening would make those files unparseable, causing `readState` to throw and `pitwall` to lose the task.

**`src/cli/drive.ts` — `--retry` logic:**

```
1. Select task in error state
2. Read error_stage from state.yml
3. If error_stage is a valid Stage:
   a. updateStage(planPath, errorStage)  // restore the failed stage
   b. dispatch(errorStage, ctx)          // re-run from the top
4. If error_stage is absent or not a valid Stage (legacy record):
   a. Print: "Task #N failed at '{error_stage}' (unrecognized stage).
              Set 'stage:' in state.yml manually and re-run 'drive'."
   b. Return without dispatching
5. Never fall through to dispatch("error", ...)
```

---

## State Management Changes

### `setError` Hardening (`src/state/store.ts`)

**Problem:** `setError` opens with `readState`, so corruption in `state.yml` — the thing it exists to record — kills it.

**Fix:**

**`store.ts` stays synchronous.** It uses `readFileSync`/`writeFileSync` throughout, and `discovery.ts` calls `readState` inside the loop that builds `Task[]`. Making these async would change `discoverTasks`'s signature and cascade into `pitwall.ts`, `drive.ts`, `radio.ts`, and `task-select.ts` — a large refactor with no benefit. Keep every signature in this module sync.

**Preserve `trivial`.** The salvage path must carry the `trivial` flag, not just `title`/`created`. A trivial task that errors and loses the flag is treated as non-trivial on `--retry`, and the prompts then reference `01_product.md` and `02_design.md`, which a trivial task never produced.

```typescript
function setError(
  planPath: string,
  errorStage: string,
  message: string
): void {
  let salvaged: Partial<TaskState> = {};

  try {
    salvaged = readState(planPath);
  } catch {
    // state.yml is unparseable — which may well be why we are here.
    // Recover what we can from the raw YAML rather than throwing.
    try {
      const parsed = parse(readFileSync(path.join(planPath, STATE_FILE), "utf-8"));
      if (typeof parsed?.title === "string") salvaged.title = parsed.title;
      if (typeof parsed?.created === "string") salvaged.created = parsed.created;
      if (typeof parsed?.trivial === "boolean") salvaged.trivial = parsed.trivial;
    } catch {
      // Give up salvaging — write a valid error record with defaults.
    }
  }

  writeState(planPath, {
    ...salvaged,
    stage: "error",
    title: salvaged.title ?? basename(planPath),
    error_stage: errorStage,
    error_message: message,
  });
}
```

Spreading `salvaged` preserves `trivial` on the happy path too, matching today's `{ ...state }` behavior.

### Validate on Write (`src/state/store.ts`)

`writeState` validates the state object against the Zod schema before serializing:

```typescript
function writeState(planPath: string, state: TaskState): void {
  // ... compute prev/next as today
  const updated = stateSchema.parse({ ...state, prev, next, updated: new Date().toISOString() });
  writeFileSync(filePath, stringify(updated), "utf-8");
}
```

Validate the fully-computed object, not the input — `prev`/`next`/`updated` are added by this function, so parsing before they exist would check the wrong shape. Sync, like the rest of the module.

This surfaces bad state at the write that caused it rather than at the next read. Diagnostic hardening — does not prevent the corruption incident on its own but limits blast radius.

---

## Prompt Design

### QA Prompt (`src/claude/prompts.ts`)

New function: `qaPrompt(ctx: TaskContext, skills?: SlashCommand[]): { prompt: string; persona: string }`

**Persona:** `"Senior QA Engineer"` — job performance measured by finding real issues.

**Prompt structure:**

```
You are a Senior QA Engineer reviewing task #{N}: "{title}".

YOUR JOB IS TO FIND PROBLEMS. A QA report that finds nothing wrong is a red
flag, not a success — it means you didn't look hard enough or you're being
agreeable. The team depends on you to catch what the engineer missed.

## Context
[Load 00_objective.md — original intent]
[Load 03_plan.md — acceptance criteria]
[Load 04_execute.md — what was claimed done]

## Required Sections in 05_qa.md
You MUST produce ALL of the following sections. No section may be omitted.

1. **What works** — Verified against acceptance criteria. For each criterion:
   run the verification command, paste its output, state pass/fail.
2. **What doesn't** — Gaps between plan and implementation. If empty, write:
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
- Write your report to 05_qa.md.

[Skills section if available]
```

### Decision Prompt

New function: `decisionPrompt(ctx: TaskContext, skills?: SlashCommand[]): { prompt: string; persona: string }`

**Persona:** `"Release Manager"`

**Prompt structure:**

```
You are a Release Manager preparing the post-deploy checklist for task #{N}.

## Context
[Load 00_objective.md — original intent]
[Load 03_plan.md — acceptance criteria]
[Load 05_qa.md — QA findings, risks, known limitations]

## Instructions
Write 06_decision.md with a checklist of everything that must be verified
AFTER DEPLOY before this task can be considered delivered.

Every item must be:
- Concretely checkable: what to look at, where, and what "good" looks like
- Traced to a source: the objective, an acceptance criterion, or a QA risk

Use markdown checkboxes: - [ ] Item description

Do NOT include boilerplate items. Every item must be specific to this task.

[Skills section if available]
```

---

## Radio Personas

### Updated Entries in `CHAT_PERSONA_MAP` and `CHAT_ROLE_DESCRIPTIONS`

**`fine_tuning`** (updated — from design Q&A):

```typescript
persona: "Senior QA Engineer"
description: "I've reviewed the QA findings in 05_qa.md. I can help you
understand the issues found, prioritize which to address, and guide fixes.
I have full context of the plan directory."
```

**`need_decision`** (new):

```typescript
persona: "Release Manager"
description: "I've read the post-deploy checklist in 06_decision.md. I can
help you work through each item, explain what to verify and how, and advise
on whether an item can be waived. I have full context of the plan directory."
```

---

## Configuration Changes

### `.vibe-racer.yml` Schema Extension

`src/config/schema.ts`:

`skills` is the only addition. **Do not touch `repo`** — it currently uses a `.refine()` enforcing a GitHub URL and deliberately accepting SSH form (`git@github.com:owner/repo`). Replacing it with `z.string().url()` would drop the GitHub check and reject every SSH remote.

```typescript
export const configSchema = z.object({
  repo: z.string().refine(
    (val) => /github\.com[/:]([^/]+)\/([^/.]+)/.test(val),
    "repo must be a GitHub URL (HTTPS or SSH)",
  ).optional(),                                    // UNCHANGED
  plans_dir: z.string().default("plans"),          // UNCHANGED
  context: z.array(z.string())
    .default(["README.md", "CLAUDE.md"]),          // UNCHANGED
  skills: z.record(z.string(), z.array(z.string())).optional(),  // NEW
  // keys are lap names: objective, product, design, plan, execute, qa, decision
  // values are arrays of skill names
});
```

Example configuration:

```yaml
skills:
  qa: ["code-review", "test-runner"]
  execute: ["tdd", "refactor"]
```

Config overrides replace defaults entirely (not additive). Omitted laps use built-in defaults.

---

## Data Flow

### End-to-End: Execution through Decision

```
handleExecute completes
  └─> updateStage("ai_qa")
  └─> print hint: "run 'drive' for QA"

operator runs `drive`
  └─> dispatch("ai_qa") → handleQa
      ├─> resolve skills for "qa" lap
      ├─> supportedCommands() → installed skills
      ├─> partition → available + missing (warn)
      ├─> build QA prompt (adversarial, evidence-based)
      ├─> run Claude session (Bash allowed, write-jailed)
      ├─> verify 05_qa.md written
      ├─> append completion checkbox
      ├─> updateStage("fine_tuning")
      └─> commit

operator reviews 05_qa.md, uses radio, ticks checkbox
  └─> tryAdvance → validates answers → advance

operator runs `drive`
  └─> dispatch("cleanup_ready") → handleDone (extended)
      ├─> existing docs pass + build/lint/test
      ├─> build decision prompt
      ├─> run Claude session → writes 06_decision.md
      ├─> append completion checkbox
      ├─> updateStage("need_decision")
      └─> commit

operator deploys, works checklist, ticks items + final checkbox
  └─> tryAdvance
      ├─> hasCompletionMarker ✓
      ├─> validateAnswers ✓ (no Answer: blocks in decision file)
      ├─> validateDecisionChecklist
      │   ├─> all checked → advance to done
      │   └─> unchecked items → removeCompletionMarker, warn, return
      └─> updateStage("done")
```

### Skills Resolution Flow

```
session.ts: runAndStream(options)
  1. resolveSkills(lap, config)        → string[] of requested skill names
  2. if empty → skip discovery entirely (no probe spawned)
  3. probe query → supportedCommands()  → SlashCommand[] of installed skills
  4. close probe
  5. partitionSkills(requested, inst)  → { available, missing }
  6. log one warning line for missing[]
  7. buildSkillsSection(available)     → prompt appendix
  8. real query: "Skill" added to allowedTools
```

Steps 3–4 exist because `supportedCommands()` lives on the returned `Query`, not on the options passed in. See Skills Integration for the constraint and its fallbacks.

### Guard Evaluation Order

```
canUseTool(toolName, input)
  Rule 0: Write/Edit on <plans_dir>/**/state.yml   → DENY + audit
  Rule 1: Sensitive path blocklist                 → DENY + audit
  Rule 2: Path containment (cwd + /tmp)            → DENY + audit
  Rule 3: .env protection                          → DENY + audit
  Rule 4a: PLAN_JAILED_STAGES + Write/Edit         → jail to plan dir
  Rule 4b: BASH_BLOCKED_STAGES + Bash              → DENY + audit
  Rule 5: Bash command filter                      → DENY + audit
  Skill:  explicit allow
  Default: allow
```

---

## Testing Strategy

### Unit Tests

| Module | Tests |
|---|---|
| `states.ts` | `nextStage` for all new transitions; `isAgentStage("ai_qa") === true`; `isHumanStage("need_decision") === true` |
| `guard.ts` | Rule 0: Write to `state.yml` denied at every stage; Rule 4a: `ai_qa` write-jailed; Rule 4b: Bash denied at review stages, allowed at `ai_qa`; `Skill` explicitly allowed |
| `validation.ts` | `validateDecisionChecklist` with all-checked, some-unchecked, completion-marker-not-counted; ordering with `hasCompletionMarker` |
| `store.ts` | `setError` with valid state, invalid YAML, missing file; `writeState` rejects invalid state |
| `schema.ts` | All 16 stages parse; `error_stage` as handler name still parses (backward compat) |
| `skills.ts` | `resolveSkills` merges defaults and config; `partitionSkills` splits correctly; empty inputs produce empty outputs |

### Integration Tests

| Scenario | Verification |
|---|---|
| Stage order regression | `nextStage("need_plan") === "ai_plan_review"` (existing); `nextStage("ready_to_execute") === "ai_qa"` (new) |
| `--retry` with valid `error_stage` | Restores stage, dispatches handler |
| `--retry` with legacy handler-name `error_stage` | Prints message, does not throw |
| Trivial fast-path | Agent writes `03_plan_questions.md`, handler sets `trivial: true`, advances to `need_plan` |
| Decision checklist enforcement | `tryAdvance` rejects when items unchecked; accepts when all checked |
| Backward compat | Old `state.yml` (no `ai_qa`/`need_decision` in history) still parses and renders in `pitwall` |

### Acceptance-Level Tests

From the product spec (AC 1–11). These are verified during execution, not automated:

- AC2 (honest QA finding) — seeded with deliberately unmet criterion
- AC7 (skill degradation) — configured nonexistent skill, verify warning + lap completion

---

## Dependency Summary

**No new runtime dependencies.** All changes use existing packages:

| Package | Used For |
|---|---|
| `@anthropic-ai/claude-agent-sdk` | `supportedCommands()` for skill discovery, `SettingSource` for `"user"` |
| `zod` | Schema validation for state and config |
| `yaml` | YAML serialization for `state.yml` |
| `commander` | CLI argument parsing (no changes) |

The `skills?: string[]` option on `AgentDefinition` (SDK) is noted but not adopted — it lives on `AgentDefinition`, not the top-level `Options` that `session.ts` uses, and adopting it would require restructuring `runAndStream`. Out of scope.
