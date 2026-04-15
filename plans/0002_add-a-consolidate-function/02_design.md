# Design Specification: `vibe-racer fasten`

> **Task**: #2 — Add a consolidate function
> **Stage**: Design Review
> **Date**: 2026-04-15

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project / Directory Structure](#project--directory-structure)
3. [Module Descriptions](#module-descriptions)
4. [State Machine Extension](#state-machine-extension)
5. [Data Flow](#data-flow)
6. [Claude Session Design](#claude-session-design)
7. [Output Parsing Strategy](#output-parsing-strategy)
8. [Duplicate Detection](#duplicate-detection)
9. [Git Integration](#git-integration)
10. [Configuration and Environment](#configuration-and-environment)
11. [Error Handling](#error-handling)
12. [Testing Strategy](#testing-strategy)
13. [Build and Distribution](#build-and-distribution)
14. [Dependency Summary](#dependency-summary)

---

## Architecture Overview

`fasten` is a new CLI command that sits beside the existing pipeline but is not a pipeline stage itself. It produces input for the pipeline — a plan folder with `00_objective.md` and `state.yml` — then exits. The pipeline takes over when the user runs `drive`.

```
                         ┌──────────────────────────────────────────┐
                         │           vibe-racer CLI                 │
                         │                                          │
                         │  init  new  drive  pitwall  radio fasten │
                         └──┬──────┬─────┬──────┬───────┬─────┬────┘
                            │      │     │      │       │     │
                            │      │     │      │       │     │
                            v      v     v      v       v     v
                         ┌──────────────────────────────────────────┐
                         │              src/state/                  │
                         │  discovery · store · advancement         │
                         │  createPlanFolder() ← NEW shared helper │
                         └──────────────┬───────────────────────────┘
                                        │
                    ┌───────────────────┬┴──────────────────┐
                    │                   │                    │
                    v                   v                    v
              ┌───────────┐     ┌─────────────┐     ┌─────────────┐
              │ pipeline/  │     │  claude/     │     │    git/     │
              │ machine    │     │  session     │     │ operations  │
              │ handlers   │     │  guard       │     │ secrets     │
              │ states     │     │  prompts     │     │ slug        │
              │            │     │  fasten ←NEW │     │             │
              └────────────┘     └─────────────┘     └─────────────┘
```

**Key architectural decisions** (traced to design Q&A):

| Decision | Source |
|---|---|
| Conditional transition in advancement logic for trivial fast-path | Q1 |
| Extract shared `createPlanFolder()` helper from `new` | Q2 |
| Standalone runner in `src/claude/fasten.ts`, reuses session + guard | Q3 |
| Prompt-embedded output template, no structural validation | Q4 |
| Reuse `discoverTasks()` for duplicate detection | Q5 |
| No branch or commit — follows `new` pattern, `drive` handles git | Q6 |

---

## Project / Directory Structure

### New files

```
src/
  cli/
    fasten.ts              # CLI command registration + orchestration
  claude/
    fasten.ts              # Analysis session runner (prompt + session call)
  state/
    plan-folder.ts         # Extracted createPlanFolder() helper
```

### Modified files

```
src/
  cli/
    index.ts               # Register `fasten` command
    new.ts                 # Refactor: delegate to createPlanFolder()
  pipeline/
    states.ts              # No change needed — trivial handled in handler
  state/
    schema.ts              # No change — `trivial` already in schema
    advancement.ts         # No change — advancement already calls nextStage()
```

### Unchanged files

The following remain untouched. The trivial fast-path already works because `handleObjectiveReview` in `src/pipeline/handlers/objective-review.ts` checks `state.trivial === true` and jumps to `need_plan`. The `fasten` command writes `state.yml` with `trivial: true` and stage `need_objective`, so the existing handler covers the skip logic when `drive` is eventually run.

---

## Module Descriptions

### `src/cli/fasten.ts` — CLI Command

Registers the `fasten` subcommand with commander and orchestrates the workflow.

```
fasten [--force]
```

**Responsibilities:**
1. Load config via `loadConfig(cwd)`
2. Run duplicate detection (call `discoverTasks()`, filter for active fasten plans)
3. Call the analysis runner in `src/claude/fasten.ts`
4. Handle zero-findings early exit (no plan created)
5. Call `createPlanFolder()` with `{ trivial: true }` and the analysis output
6. Print summary to terminal

**Interface:**

```typescript
export async function fastenCommand(opts: { force?: boolean }): Promise<void>
```

Registered in `src/cli/index.ts` as:

```typescript
program
  .command("fasten")
  .description("Run dead code analysis and create a cleanup plan")
  .option("--force", "Create a new fasten plan even if an active one exists")
  .action(wrapAction(fastenCommand));
```

---

### `src/claude/fasten.ts` — Analysis Runner

Standalone Claude session runner for the dead code analysis. Does not use the pipeline's prompt builder or persona system.

**Responsibilities:**
1. Build the analysis prompt (hardcoded prompt from objective + output template from product spec)
2. Load project context files (README.md, CLAUDE.md) if available
3. Call `runAndStream()` with a read-only guard configuration
4. Return the raw Claude response string

**Interface:**

```typescript
export interface FastenAnalysisResult {
  output: string;       // Raw markdown response from Claude
  isEmpty: boolean;     // True if Claude found no dead code
}

export async function runFastenAnalysis(cwd: string): Promise<FastenAnalysisResult>
```

**Guard configuration:**

The analysis session needs to read the entire codebase but must not write anything. The guard is configured by passing a stage and taskPlanPath to `createToolGuard()`. Since `fasten` runs before any plan folder exists, the guard needs a read-only profile.

Two options exist within the current guard architecture:
- **Option A**: Pass a review stage (e.g., `ai_objective_review`) as the stage parameter. Review stages restrict Write/Edit to the task plan path only. Since no plan path exists yet, passing an empty string effectively blocks all writes.
- **Option B**: Add a dedicated `"analysis"` pseudo-stage to the guard that explicitly blocks Write/Edit/Bash.

**Recommendation**: Option A — pass `stage: "ai_objective_review"` and `taskPlanPath: ""`. This leverages existing guard logic: review stages restrict writes to the plan folder, and an empty plan path means no writes are allowed anywhere. No guard changes needed.

**Allowed tools**: `["Read", "Glob", "Grep"]` — the analysis only needs to read files and search the codebase. Write, Edit, and Bash are excluded from the allowed tools list entirely, providing a second layer of protection beyond the guard.

---

### `src/state/plan-folder.ts` — Shared Plan Creation Helper

Extracted from `src/cli/new.ts`. Both `new` and `fasten` call this to create a plan folder with `state.yml`.

**Interface:**

```typescript
export interface CreatePlanOptions {
  title: string;
  plansDir: string;
  slug: string;
  trivial?: boolean;
  objectiveContent?: string;  // If provided, written to 00_objective.md
  checkboxLabel: string;      // e.g., "Objective Review" or "Plan Questions"
  checked?: boolean;          // Whether the checkbox starts ticked
}

export interface CreatedPlan {
  taskNumber: number;
  folderName: string;
  planDir: string;
}

export function createPlanFolder(options: CreatePlanOptions): CreatedPlan
```

**Behavior:**
1. Call `getNextTaskNumber(plansDir)` to determine task number
2. Create folder `{NNNN}_{slug}` under `plansDir`
3. Write `00_objective.md` with objective content and completion checkbox
4. Write `state.yml` with initial stage `need_objective`, title, timestamps, and optional `trivial: true`
5. Return task number and paths

---

## State Machine Extension

### Trivial fast-path

The trivial fast-path **already exists** in the codebase. The `handleObjectiveReview` handler in `src/pipeline/handlers/objective-review.ts` already checks:

```typescript
if (updatedState.trivial === true) {
  updateStage(ctx.planPath, "need_plan");
  log.info("Task classified as trivial — skipping product and design stages");
}
```

And the `stateSchema` in `src/state/schema.ts` already includes `trivial: z.boolean().optional()`.

**No state machine changes are required.** The `fasten` command writes `state.yml` with `trivial: true` and stage `need_objective`. When the user ticks the checkbox and runs `drive`:

```
need_objective  →  (human ticks checkbox)  →  ai_objective_review
                                                      │
                                              trivial === true
                                                      │
                                                      v
                                                  need_plan
```

The objective review handler reads the `trivial` flag from `state.yml` and skips to `need_plan`. The existing pipeline handles this without modification.

### Stage path for fasten plans

```
need_objective ──► ai_objective_review ──► need_plan ──► ai_plan_review ──►
need_execution ──► ready_to_execute ──► fine_tuning ──► cleanup_ready ──► done
```

Stages `need_product`, `ai_product_review`, `need_design`, `ai_design_review` are bypassed by the trivial check in the objective review handler.

---

## Data Flow

### `vibe-racer fasten` — end to end

```
User runs: vibe-racer fasten
    │
    ▼
┌─────────────────────────────────────────────┐
│  1. loadConfig(cwd)                         │
│     → VibeRacerConfig { plans_dir, context }│
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  2. Duplicate detection                     │
│     discoverTasks(plansDir)                 │
│     → filter: slug contains "fasten-"       │
│       AND stage not in ["done", "error"]    │
│     → if match && !opts.force: warn + exit  │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  3. runFastenAnalysis(cwd)                  │
│     → builds prompt (analysis + template)   │
│     → calls runAndStream() with read-only   │
│       guard (allowed: Read, Glob, Grep)     │
│     → streams output to terminal            │
│     → returns { output, isEmpty }           │
└─────────────────┬───────────────────────────┘
                  │
           ┌──────┴───────┐
           │              │
     isEmpty=true    isEmpty=false
           │              │
           ▼              ▼
  Print "No dead    ┌─────────────────────────────┐
  code found"       │  4. createPlanFolder({       │
  Exit 0            │     title: "fasten-YYYY-MM-DD",│
                    │     slug: "fasten-YYYY-MM-DD", │
                    │     trivial: true,            │
                    │     objectiveContent: output, │
                    │     checkboxLabel: "Plan Questions",│
                    │     checked: false            │
                    │  })                           │
                    └─────────────┬─────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │  5. Print summary            │
                    │     "Created task #N: ..."   │
                    │     "Review and tick checkbox"│
                    └─────────────────────────────┘
```

### After fasten — pipeline takes over

```
User reviews 00_objective.md
User ticks checkbox: [x] Ready to advance to Plan Questions
User runs: vibe-racer drive
    │
    ▼
drive discovers task → tryAdvance() detects checkbox
    → advances: need_objective → ai_objective_review
    → dispatch(ai_objective_review, ctx)
    → handleObjectiveReview reads state.trivial === true
    → updateStage → need_plan
    → commits
    │
    ▼
User reviews 03_plan_questions.md (generated by objective review handler)
User ticks checkbox
User runs: vibe-racer drive
    → continues through pipeline normally
```

---

## Claude Session Design

### Prompt construction

The analysis prompt is composed of three parts:

```
┌─────────────────────────────────────────┐
│  1. System context (project files)      │
│     README.md, CLAUDE.md (if they exist)│
├─────────────────────────────────────────┤
│  2. Analysis instructions               │
│     (hardcoded from objective prompt)   │
│     - 6 categories of dead code         │
│     - Per-finding requirements          │
├─────────────────────────────────────────┤
│  3. Output template                     │
│     (locked markdown format from        │
│      product spec — 3-bucket tables)    │
└─────────────────────────────────────────┘
```

The system prompt uses the `claude_code` preset (same as all other sessions) but with no persona appended — the analysis is a utility task, not a pipeline role.

### Session parameters

| Parameter | Value | Rationale |
|---|---|---|
| `prompt` | Analysis instructions + output template | Static, hardcoded |
| `persona` | `""` (empty) | No role needed for analysis |
| `cwd` | Project root | Analysis scans entire project |
| `allowedTools` | `["Read", "Glob", "Grep"]` | Read-only analysis |
| `stage` | `"ai_objective_review"` | Triggers review-stage guard (restricts writes) |
| `taskPlanPath` | `""` | No plan folder yet — blocks all writes |
| `maxTurns` | `undefined` (default) | Let Claude use as many turns as needed |

### Zero-findings detection

After the session completes, the `fasten` runner checks whether the output indicates no findings. The detection heuristic:

- Check if the "Safe to Delete" and "Needs Review" and "Keep but Flag" tables are all empty (no data rows)
- Or check for a specific phrase like "no dead code found" in the response

If empty, return `{ output, isEmpty: true }`. The CLI command then prints a clean message and exits without creating a plan folder.

---

## Output Parsing Strategy

**Decision (Q4):** Trust Claude to produce conformant markdown. No structural validation.

The output template is embedded in the prompt as an explicit example. Claude fills in the tables. The dividing line for error handling:

| Scenario | Action |
|---|---|
| SDK error / timeout / empty response | Abort. Print error. No plan folder created. |
| Non-empty response, any format | Write to `00_objective.md` as-is. Human reviews. |

No markdown parsing, no JSON intermediate, no formatting pass. The output is a human-reviewed artifact — minor formatting deviations are acceptable and easily corrected during review.

---

## Duplicate Detection

**Decision (Q5):** Reuse `discoverTasks()` from `src/state/discovery.ts`.

```typescript
function hasActiveFastenPlan(plansDir: string): Task | undefined {
  const tasks = discoverTasks(plansDir);
  return tasks.find(
    (t) => t.slug.startsWith("fasten-") && t.stage !== "done" && t.stage !== "error"
  );
}
```

Called at the start of `fastenCommand()`. If a match is found and `--force` is not set:

```
An active fasten plan already exists (task #N).
Run `vibe-racer drive` to complete it, or use `vibe-racer fasten --force` to create a new one.
```

Exit code 1.

---

## Git Integration

**Decision (Q6):** Follow the `new` command pattern — no branch, no commit.

`fasten` writes files to the working directory only. The branch (`vibe-racer/NNNN_fasten-YYYY-MM-DD`) is created when the user first runs `drive` on the task. This is consistent with how `new` works and avoids creating branches for plans the user might discard.

---

## Configuration and Environment

### Required

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API access (or `claude login`) |
| `.vibe-racer.yml` | Must exist (created by `vibe-racer init`) |

### Used from config

| Field | Usage |
|---|---|
| `plans_dir` | Where to create the plan folder |
| `context` | Files loaded into Claude's context for the analysis |

### Not required

- No new environment variables
- No new config fields
- No changes to `.vibe-racer.yml` schema

---

## Error Handling

| Failure mode | Behavior | Exit code |
|---|---|---|
| No `.vibe-racer.yml` found | Error: "Run `vibe-racer init` first" (existing behavior from `loadConfig`) | 1 |
| Active fasten plan exists | Warning + suggestion to use `--force` or `drive` | 1 |
| Claude session fails (SDK error, timeout) | Print error: "Analysis failed. Run vibe-racer fasten again to retry." No plan folder created. | 1 |
| Empty Claude response | Treated as session failure — same as above | 1 |
| No dead code found | Clean message: "No dead code found — nothing to fasten." | 0 |
| Plan folder creation fails (disk error) | Propagated by `wrapAction()` error handler | 1 |

**Atomicity guarantee:** The plan folder is created only after the Claude session completes successfully and returns a non-empty, non-zero-findings response. No partial state is written to disk during the analysis.

---

## Testing Strategy

### Unit tests

| Module | Tests |
|---|---|
| `src/state/plan-folder.ts` | Creates folder, writes correct state.yml, handles trivial flag, generates sequential task numbers |
| `src/claude/fasten.ts` | Prompt includes all 6 categories + output template; isEmpty detection works for empty/non-empty responses |
| `src/cli/fasten.ts` | Duplicate detection logic; force flag bypass; zero-findings early exit; happy path orchestration |

### Integration tests

| Scenario | Validation |
|---|---|
| Happy path | `fasten` creates plan folder with correct structure; `drive` advances through trivial path to `need_plan` |
| Zero findings | No plan folder created; exit code 0 |
| Duplicate detection | Second `fasten` blocked; `--force` overrides |
| Session failure | No plan folder on disk; error message printed |

### Testing approach for Claude session

The `runAndStream()` call should be mocked in unit tests — it's an external SDK call. Integration tests can use a test fixture with a known codebase and verify the end-to-end flow, but the Claude response itself should be stubbed to keep tests deterministic and fast.

---

## Build and Distribution

No changes to the build pipeline. The new files are TypeScript modules under `src/` and will be picked up by the existing `tsup` build configuration. The `fasten` command is registered in `createProgram()` alongside existing commands — no separate entry point needed.

---

## Dependency Summary

### No new dependencies

All functionality is built on existing project dependencies:

| Dependency | Usage |
|---|---|
| `commander` | CLI registration (existing) |
| `@anthropic-ai/claude-agent-sdk` | Claude session via `runAndStream()` (existing) |
| `yaml` | state.yml read/write (existing) |
| `zod` | Schema validation (existing) |
| `vitest` | Testing (existing) |

### Internal dependencies (new module → existing module)

| New module | Imports from |
|---|---|
| `src/cli/fasten.ts` | `src/config/loader`, `src/state/discovery`, `src/state/plan-folder` (new), `src/claude/fasten` (new), `src/utils/logger` |
| `src/claude/fasten.ts` | `src/claude/session`, `src/claude/guard` |
| `src/state/plan-folder.ts` | `src/state/discovery` (`getNextTaskNumber`), `src/state/store` (`writeState`), `src/pipeline/validation` (`completionSection`) |
