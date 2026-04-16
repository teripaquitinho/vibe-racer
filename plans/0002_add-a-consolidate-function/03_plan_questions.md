# Plan Questions for #2: Add a consolidate function

> **Role**: Senior Software Engineer
> **Stage**: `ai_design_review` → `need_plan`
> **Date**: 2026-04-15

---

## Build Sequence

### Q1: In what order should the three new modules be built and integrated?

The design introduces three new modules: `src/state/plan-folder.ts` (shared helper), `src/claude/fasten.ts` (analysis runner), and `src/cli/fasten.ts` (CLI command). What's the build order, and should the `new` command refactor happen first or in parallel with the new modules?

**Answer:**
Build bottom-up in three milestones:

1. **Milestone 1 — Extract `createPlanFolder()`**: Refactor `src/cli/new.ts` to delegate to the new `src/state/plan-folder.ts` helper. This is a pure refactor with zero behavior change — validate by running the existing `new` command tests and confirming they still pass. Commit this independently so the refactor is isolated and reviewable.

2. **Milestone 2 — Analysis runner**: Build `src/claude/fasten.ts` with the hardcoded prompt and zero-findings detection. Unit-test it with a mocked `runAndStream()`. This can be built and tested in isolation since it has no dependency on milestone 1.

3. **Milestone 3 — CLI command**: Build `src/cli/fasten.ts`, wire up duplicate detection, call the analysis runner, call `createPlanFolder()`, register in `src/cli/index.ts`. This depends on both M1 and M2.

Milestones 1 and 2 can be built in parallel. Milestone 3 is the integration point.

---

## Testing Approach

### Q2: Should the Claude session be mocked or stubbed in tests, and how should the zero-findings edge case be tested?

The analysis runner calls `runAndStream()` which hits the Claude API. In tests, we need deterministic behavior without API calls. Should we mock at the `runAndStream` level, at the SDK `query` level, or use a fixture-based approach?

**Answer:**
Mock at the `runAndStream` level — it's the boundary between our code and the SDK. Use `vi.mock("../claude/session.js")` to replace `runAndStream` with a function that returns canned markdown responses. Create two test fixtures:

- `fixtures/fasten-with-findings.md` — a valid analysis with entries in all three tables
- `fixtures/fasten-empty.md` — a valid analysis with empty tables (zero findings)

This keeps tests fast, deterministic, and decoupled from SDK internals. The zero-findings detection logic in `runFastenAnalysis` gets tested against the empty fixture.

---

### Q3: What's the integration test strategy for the trivial fast-path?

The trivial fast-path is the most cross-cutting behavior — it spans `fasten` (writes `trivial: true`), `drive` (advances stages), and the objective review handler (skips to `need_plan`). How should this be tested end-to-end without a live Claude session?

**Answer:**
Write one integration test that exercises the full path with mocked Claude sessions:

1. Call `fastenCommand()` with a mocked `runAndStream` that returns a canned analysis
2. Assert: plan folder exists with `state.yml` containing `trivial: true` and stage `need_objective`
3. Manually tick the checkbox in the generated `00_objective.md` (write `[x]` to the file)
4. Call `driveCommand()` with a mocked `runAndStream` for the objective review handler
5. Assert: `state.yml` stage is now `need_plan`, confirming the trivial skip worked

This test lives in `src/__tests__/fasten-integration.test.ts` and uses a temp directory as the project root. It validates the contract between `fasten` and the pipeline without hitting the API.

---

## Refactoring Scope

### Q4: How much of the `new` command should be extracted into `createPlanFolder()`, and should the helper's API support future callers beyond `fasten`?

The design says to extract plan creation logic from `new.ts` into `plan-folder.ts`. The current `new` command handles task numbering, folder creation, objective file writing, state.yml writing, and terminal output. How much moves to the helper vs. stays in the command?

**Answer:**
Move everything except terminal output into the helper. Specifically, `createPlanFolder()` should handle:

- `getNextTaskNumber()` call
- `mkdirSync` for the folder
- Writing `00_objective.md` with content + completion checkbox
- Writing `state.yml` with stage, title, timestamps, and optional `trivial`

Keep terminal output (`log.success`, `log.info`) in the CLI command — the helper is a pure state operation, the command owns the UX. The helper's API (as specified in the design) already accommodates both `new` and `fasten` without over-generalizing: `title`, `slug`, `trivial`, `objectiveContent`, `checkboxLabel`, `checked`. Don't add parameters for hypothetical future callers.

---

## Prompt Engineering

### Q5: Should the analysis prompt be stored as a template string in the source code or as a separate file?

The design specifies the prompt is hardcoded (from the objective) plus the output template (from the product spec). Together these are ~60-80 lines of markdown. Should this live as a template literal in `src/claude/fasten.ts`, or as a separate `.md` file that gets loaded at runtime?

**Answer:**
Template literal in `src/claude/fasten.ts`. The prompt is static and tightly coupled to the fasten runner — there's no reason to separate it. A `.md` file would add a runtime file-read, a path resolution concern, and make it harder to see the prompt in context when debugging. The existing `src/claude/prompts.ts` uses template literals for all pipeline prompts, so this is consistent with the codebase convention. If the prompt grows significantly in a future iteration, it can be extracted then.

---

## Deployment and Rollout

### Q6: Should the `fasten` command be gated behind a flag or shipped as a full command from day one?

This is a new user-facing command that changes the CLI surface. Should it ship as a stable command immediately, or behind an experimental flag (e.g., `--experimental` or listed under a separate command group)?

**Answer:**
Ship as a full command from day one — no flag. The command is self-contained (doesn't modify existing behavior), low-risk (worst case: a bad analysis that the user discards), and the trivial fast-path it depends on already exists in the pipeline. Gating it behind a flag adds complexity for no real safety benefit. Update the README commands table and the docs site to include `fasten` as part of the release.

---

# Complete

- [x] Ready to advance to Plan Review
