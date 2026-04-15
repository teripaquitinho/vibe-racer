# Design Questions for #2: Add a consolidate function

> **Role**: Senior Software Architect
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-04-15

---

## State Machine Extension

### Q1: How should the trivial fast-path be implemented in the state machine?

The product spec requires `trivial: true` plans to skip from `need_objective` directly to `need_plan`, bypassing four stages. Should this be implemented as (a) a conditional transition in the advancement logic that checks `trivial` and jumps ahead, (b) a separate linear stage list for trivial plans, or (c) a `skip` array in `state.yml` listing stages to bypass?

**Answer:**
Option (a) — conditional transition in the advancement logic. In `src/state/` where `advanceStage()` computes the next stage, add a check: if the current stage is `need_objective` and `state.trivial === true`, set the next stage to `need_plan` instead of `ai_objective_review`. This is the smallest change — no new data model, no second stage list. The `prev`/`next` fields in `state.yml` continue to be auto-computed, they'll just reflect the jump. Keep the full stage enum unchanged so that `pitwall` display and stage validation don't need modification.

---

## CLI Registration

### Q2: Where should the `fasten` command live and how should it relate to the existing `new` command?

`fasten` creates a plan folder like `new` does, but also runs a Claude session before writing the objective. Should `fasten` import and call `new`'s plan-creation logic internally, or should the shared logic be extracted into a helper that both commands use?

**Answer:**
Extract the plan-creation logic (folder creation, `state.yml` write, task numbering) from `src/cli/new.ts` into a shared helper in `src/state/` — something like `createPlanFolder(slug, options)` that both `new` and `fasten` call. `fasten` would call this helper with `{ trivial: true }` after the analysis succeeds. This avoids `fasten` importing a CLI command module and keeps the layering clean: CLI commands call state helpers, not each other.

---

## Claude Session Design

### Q3: How should the `fasten` analysis session be structured — as a new handler in `src/pipeline/`, or as a standalone runner outside the pipeline?

The existing pipeline handlers are tied to stage transitions (`ai_objective_review`, `ai_product_review`, etc.). The `fasten` analysis runs before any stage exists — it produces the plan that enters the pipeline. Should it use the pipeline's session infrastructure (prompt builder, persona, tool guard), or should it be a lighter-weight standalone Claude call?

**Answer:**
Standalone runner in `src/claude/` — something like `src/claude/fasten.ts`. It should reuse the SDK session runner (`src/claude/session.ts`) and the tool guard, but it does not need the pipeline's prompt builder or persona system. The analysis prompt is static (hardcoded from the objective), the persona is irrelevant (this isn't a lap), and the output is a one-shot structured report, not a pipeline document. Import the session runner and guard directly; skip the pipeline dispatch entirely.

---

## Output Parsing

### Q4: How should the structured analysis output be extracted from Claude's response?

Claude will produce a free-form analysis following the prompt's instructions. The product spec requires a specific markdown table format in `00_objective.md`. Should the command (a) include the output format in the prompt and trust Claude to produce it correctly, (b) ask Claude for structured JSON and render the markdown ourselves, or (c) use a two-pass approach — first analysis, then a formatting pass?

**Answer:**
Option (a) — include the exact output template in the prompt and trust Claude to produce conformant markdown. The locked output format from the product spec (three-bucket tables with specific columns) should be appended to the analysis prompt as an explicit output template. Claude is reliable at following markdown templates, and this avoids parsing complexity. If the output is malformed, the command should write it anyway and let the human fix it during review — this is a human-reviewed artifact, not machine-consumed data.

---

## Duplicate Detection

### Q5: How should active fasten plan detection work — scan folder names or read `state.yml` contents?

The product spec says to check for existing `fasten-*` plans not in `done` stage. Should the detection scan plan folder names matching the `fasten-` pattern and then read their `state.yml`, or should it use the existing task discovery in `src/state/` to iterate all tasks and filter?

**Answer:**
Use the existing task discovery in `src/state/` — it already reads all `state.yml` files and returns task metadata. Filter the results for tasks whose slug contains `fasten-` and whose stage is not `done` and not `error`. This avoids duplicating the folder-scanning logic, stays consistent with how `pitwall` discovers tasks, and correctly handles edge cases like corrupted or missing `state.yml` files (the discovery module already handles those).

---

## Git Integration

### Q6: Should `fasten` create a branch and commit the generated plan, or leave that to `drive`?

The existing `new` command does not create a branch or commit — it just writes files to disk. `fasten` writes more content (the full analysis), but the product spec says the human reviews and ticks the checkbox before running `drive`. Should `fasten` follow the same pattern as `new` (no branch, no commit), or should it create the branch and commit immediately since it produces a complete artifact?

**Answer:**
Follow the same pattern as `new` — no branch creation, no commit. The branch is created on first `drive`, which is the established convention. `fasten` writes files to the working directory; the user reviews; `drive` creates the branch and commits. This keeps `fasten` consistent with `new`, avoids creating branches for plans the user might discard after review, and doesn't surprise users who expect `drive` to be the branch-creating action.

---

# Complete

- [ ] Ready to advance to Design Review
