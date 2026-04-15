# Product Specification: `vibe-racer fasten`

> **Task**: #2 — Add a consolidate function
> **Stage**: Product Review
> **Date**: 2026-04-15

---

## Table of Contents

1. [Product Overview](#product-overview)
2. [Command Interface](#command-interface)
3. [Workflow](#workflow)
4. [Output Format](#output-format)
5. [Trivial Fast-Path](#trivial-fast-path)
6. [Edge Cases and Error Recovery](#edge-cases-and-error-recovery)
7. [Scope Boundaries](#scope-boundaries)
8. [Acceptance Criteria](#acceptance-criteria)

---

## Product Overview

`vibe-racer fasten` is a new CLI command that runs a dead code analysis on the host project via Claude and writes the structured findings into a new plan's `00_objective.md`. The plan is pre-configured as trivial, skipping product and design laps, so the user reviews the analysis, ticks the checkbox, and goes straight to plan questions.

The name "fasten" follows the racing metaphor: fastening loose parts before you race — tightening the codebase by removing dead weight.

**Traceability**: This command was scoped in Q1 (single command doing analysis + plan creation), with output format locked in Q2, pipeline integration defined in Q3, naming in Q4, edge cases in Q5, and duplicate protection in Q6.

---

## Command Interface

```
vibe-racer fasten [--force]
```

| Argument | Required | Description |
|---|---|---|
| `--force` | No | Create a new fasten plan even if an active one exists (Q6) |

No positional arguments. No custom suffix — the plan folder name is auto-generated (Q4).

### Plan naming convention

```
NNNN_fasten-YYYY-MM-DD
```

- `NNNN`: Next sequential task number (same as `vibe-racer new`)
- `YYYY-MM-DD`: Date of analysis run
- Example: `0003_fasten-2026-04-15`

---

## Workflow

### Happy path

```
User runs                   CLI action                          User action
─────────                   ──────────                          ───────────
vibe-racer fasten      →    1. Check for active fasten plans
                            2. Run dead code analysis via Claude
                            3. Create plan folder (NNNN_fasten-YYYY-MM-DD)
                            4. Write structured analysis to 00_objective.md
                            5. Write state.yml with trivial fast-path
                            6. Print summary to terminal
                                                            →   Review 00_objective.md
                                                                Edit findings if needed
                                                                Tick checkbox
vibe-racer drive       →    Advance to plan questions (skip product + design)
                                                            →   Review plan questions
                                                                Tick checkbox
vibe-racer drive       →    Execute: remove dead code, run tests, commit
```

### State machine path for fasten-generated plans

```
need_objective  →  (trivial: skip to)  →  need_plan  →  ai_plan_review  →
need_execution  →  ready_to_execute  →  fine_tuning  →  cleanup_ready  →  done
```

The stages `ai_objective_review → need_product → ai_product_review → need_design → ai_design_review` are all skipped (Q3).

---

## Output Format

> **Locked spec** — this format is decided at product stage and must not be redesigned in the design lap (Q2).

The generated `00_objective.md` must follow this structure:

```markdown
# Objective

Dead code analysis for [project name] — run by `vibe-racer fasten` on YYYY-MM-DD.

## Summary

{Total findings count by category. e.g., "Found 12 items: 7 safe to delete,
3 need review, 2 to keep but flag."}

## Safe to Delete

Items with **high confidence** that can be removed without risk.

| # | File | Line | Type | Why it appears dead | Action |
|---|------|------|------|---------------------|--------|
| 1 | src/foo.ts | 42 | Unused export | Exported but never imported anywhere | Delete |
| ... | | | | | |

## Needs Review

Items with **medium or low confidence** — may have dynamic usage, reflection,
or external consumers.

| # | File | Line | Type | Why it appears dead | Confidence | Action |
|---|------|------|------|---------------------|------------|--------|
| 1 | src/bar.ts | 18 | Unused import | Imported but never referenced | Medium | Investigate |
| ... | | | | | | |

## Keep but Flag

Items that are technically dead but should be preserved for now
(e.g., public API surface, upcoming feature flags).

| # | File | Line | Type | Why it's flagged | Reason to keep |
|---|------|------|------|------------------|----------------|
| ... | | | | | |

# Complete

- [ ] Ready to advance to Plan Questions
```

### Analysis categories

As specified in the objective's analysis prompt, the Claude session should look for:

1. Unused exports
2. Unreachable code
3. Unused variables and imports
4. Dead feature flags / disabled blocks
5. Unused files/modules
6. Deprecated internal APIs

Each finding includes: file path, line number, why it appears dead, confidence level (high/medium/low), and recommended action (delete, consolidate, or investigate).

---

## Trivial Fast-Path

> **Flag for design lap**: the trivial fast-path does not yet exist in the state machine. This task must introduce it (Q3).

### Behavior

When `state.yml` contains `trivial: true`, the state machine skips from `need_objective` directly to `need_plan`, bypassing:

- `ai_objective_review`
- `need_product`
- `ai_product_review`
- `need_design`
- `ai_design_review`

### How it's set

- `fasten`-generated plans set `trivial: true` automatically in `state.yml`
- The user can override by editing `state.yml` to set `trivial: false` if the consolidation turns out to be unexpectedly complex
- The existing `vibe-racer new` command is not affected — it continues to create full-pipeline plans by default

### state.yml for fasten plans

```yaml
stage: need_objective
title: "fasten-2026-04-15"
trivial: true
created: 2026-04-15T10:00:00.000Z  # illustrative — set to actual run time
updated: 2026-04-15T10:00:00.000Z  # illustrative — set to actual run time
```

---

## Edge Cases and Error Recovery

### No dead code found (Q5a)

- Do **not** create a plan folder
- Print: `No dead code found — nothing to fasten.`
- Exit with code 0 (success, not an error)

### Active fasten plan exists (Q6)

- Before running the analysis, scan all plan folders for `fasten-*` slugs
- Check their `state.yml` — if any is not in `done` or `error` stage, warn:
  ```
  An active fasten plan already exists (task #N).
  Run `vibe-racer drive` to complete it, or use `vibe-racer fasten --force` to create a new one.
  ```
- Exit with code 1 (blocked)
- With `--force`: skip the check, create a new plan regardless

### Claude session failure

- If the Claude SDK session fails mid-analysis, do not create a plan folder
- Print the error and suggest retrying: `Analysis failed. Run vibe-racer fasten again to retry.`
- No partial state is written to disk

### No project context available

- If neither `README.md` nor `CLAUDE.md` exists, proceed anyway — the analysis runs against the codebase itself, not the docs
- Context files from `.vibe-racer.yml` are loaded if available but are not required for `fasten`

---

## Scope Boundaries

### In scope

- New `fasten` CLI command
- Dead code analysis via Claude Code SDK session
- Structured output written to `00_objective.md`
- Trivial fast-path in the state machine (skip product + design laps)
- Duplicate fasten plan detection with `--force` override
- Zero-findings early exit

### Out of scope

- Custom analysis prompts (the prompt is hardcoded as specified in the objective)
- Incremental analysis (diffing against previous fasten runs)
- Auto-deletion of dead code (the pipeline handles execution)
- Custom plan naming (use `vibe-racer new` for that)
- Size limits or pagination for large reports (revisit if needed — Q5b)
- Language-specific analysis tooling (relies entirely on Claude's analysis)

---

## Acceptance Criteria

1. **Command exists**: `vibe-racer fasten` is a registered CLI command that runs without errors on a valid project
2. **Analysis runs**: The command launches a Claude Code SDK session with the dead code analysis prompt from the objective
3. **Plan created**: A plan folder `NNNN_fasten-YYYY-MM-DD` is created with a correctly formatted `00_objective.md` and `state.yml`
4. **Output format**: The objective file matches the locked spec from Q2 — three-bucket structure with summary, file paths, line numbers, confidence levels, and actions
5. **Trivial flag**: `state.yml` contains `trivial: true` and the plan skips product and design laps when driven
6. **Checkbox unticked**: The `00_objective.md` completion checkbox is unticked (`- [ ]`), requiring human review before advancing
7. **Zero findings**: When no dead code is found, no plan folder is created and a clean message is printed
8. **Duplicate detection**: Running `fasten` with an active fasten plan prints a warning and exits; `--force` overrides this
9. **Failure safety**: A failed Claude session leaves no partial plan folder on disk
10. **Pipeline integration**: After the user ticks the checkbox and runs `vibe-racer drive`, the plan advances to `need_plan` (not `need_product`)
