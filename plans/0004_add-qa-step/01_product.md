# Product Specification: Add QA Step (#4)

> **Stage**: `ai_product_review`
> **Date**: 2026-08-24

---

## Table of Contents

1. [Product Overview](#product-overview)
2. [Workstream Summary](#workstream-summary)
3. [State Machine](#state-machine)
4. [Lap 6: QA](#lap-6-qa)
5. [Pit Stop: Fine-Tuning (Post-QA)](#pit-stop-fine-tuning-post-qa)
6. [Lap 7: Decision](#lap-7-decision)
7. [Operator Workflow: Execution through Decision](#operator-workflow-execution-through-decision)
8. [Trivial Tasks](#trivial-tasks)
9. [Pipeline Naming](#pipeline-naming)
10. [Radio Personas at New Stages](#radio-personas-at-new-stages)
11. [Engineering Skills (Workstream B)](#engineering-skills-workstream-b)
12. [state.yml Corruption Fix (Workstream A)](#stateyml-corruption-fix-workstream-a)
13. [Configuration Changes](#configuration-changes)
14. [Edge Cases and Error Recovery](#edge-cases-and-error-recovery)
15. [Scope Boundaries](#scope-boundaries)
16. [Acceptance Criteria](#acceptance-criteria)

---

## Product Overview

This task extends the vibe-racer pipeline from five laps to seven, adding a **QA lap** after execution and a **decision lap** that gates task closure behind a post-deploy checklist. Alongside the new stages, the task closes a `state.yml` corruption bug and wires engineering skills into every lap.

The three workstreams ship together because they touch the same core files (`states.ts`, `prompts.ts`, `guard.ts`, `schema.ts`).

---

## Workstream Summary

| Workstream | Purpose |
|---|---|
| A — `state.yml` corruption fix and error recovery | Deny agent writes to `state.yml`, harden `setError`, validate on write, re-plumb the trivial fast-path, make `drive --retry` actually work |
| B — Engineering skills | Wire `Skill` tool into sessions, per-lap skill defaults, graceful degradation for missing skills |
| C — QA and decision laps | Two new stages (`ai_qa`, `need_decision`), two new documents (`05_qa.md`, `06_decision.md`), updated `radio` personas |

---

## State Machine

`STAGES` extends from 14 entries to 16 — or 13 to 15 in `STAGE_ORDER`, which filters out `error`. Two new stages are inserted after execution:

```
need_objective   → ai_objective_review
need_product     → ai_product_review
need_design      → ai_design_review
need_plan        → ai_plan_review
need_execution   → ready_to_execute    (milestone loop, unchanged)
                 → ai_qa              NEW — writes 05_qa.md
                 → fine_tuning              — operator reviews QA, makes fixes
                 → cleanup_ready            — docs pass + writes 06_decision.md
                 → need_decision      NEW — operator works post-deploy checklist
                 → done
```

`STAGE_ORDER` is positional. The insertion order is: `ai_qa` immediately after `ready_to_execute`, and `need_decision` immediately after `cleanup_ready`.

**Backward compatibility:** Existing `state.yml` files with `next:` values computed under the old stage order self-heal because `next` is recomputed on every write. Existing tasks in `plans/0001`–`0003` must still parse, and `pitwall` must render them.

---

## Lap 6: QA

**Stage**: `ai_qa`
**Output**: `05_qa.md`
**Trigger**: Execution completes and parks the task at `ai_qa`. The operator runs `drive` again to start QA.

*(Decision from Q1: Execution does not chain into QA. Each `drive` invocation dispatches exactly one handler.)*

### What QA produces

The QA session performs a thorough, honest review of the work produced during execution. `05_qa.md` must cover:

| Section | Content |
|---|---|
| **What works** | Verified against the plan's acceptance criteria, with evidence (test names, commands run, output). Not "milestone 3 says done." |
| **What doesn't** | Gaps between `03_plan.md` and what was built, bugs found, unmet acceptance criteria |
| **What regressed** | Behavior that worked before this task and does not now |
| **Deviations** | Where execution departed from the plan, and whether the departure was sound |
| **Risks and known limitations** | Carried into the decision checklist |
| **Verification run** | Build, lint, tests — actual results pasted, not summarized |

### Honesty as a first-class prompt concern

A QA lap that reports everything as fine is worse than no QA lap — it launders an unverified result into a verified-looking one. The QA prompt must actively push against the model's pull toward agreeable summaries. This is a design-level concern, not a footnote.

### Guard treatment

QA must not fix what it is judging — writes are jailed to the plan directory. QA also needs `Bash` to run tests.

**Correction to an earlier reading:** `REVIEW_STAGES` does not block Bash. The guard's only stage-conditional rule is the Write/Edit path jail (`guard.ts` Rule 4). Bash is kept out of review stages by each handler's `ALLOWED_TOOLS` — `review-runner.ts` simply omits it — and `formatGuardSummary` merely *prints* `bash: blocked (review stage)`, which is a cosmetic string, not enforcement. So `ai_qa` could join `REVIEW_STAGES` as-is and still run Bash; the only breakage would be that summary line lying.

`ai_qa`'s actual requirement is therefore: plan-directory write jail, Bash allowed, and a guard summary that tells the truth. Whether to also make Bash gating explicit in the guard — rather than leaving it to `allowedTools` alone — is a design-lap decision, and would be a deliberate hardening rather than a refactor.

### Completion checkbox

`05_qa.md` ends with: `- [ ] Ready to advance to Cleanup`

This checkbox replaces the one currently in `04_execute.md`. `STAGE_QUESTIONS_FILE[fine_tuning]` moves from `04_execute.md` to `05_qa.md`, and `handleExecute` stops rewriting the execution playbook's checkbox.

---

## Pit Stop: Fine-Tuning (Post-QA)

**Stage**: `fine_tuning`
**File**: `05_qa.md`

This stage is unchanged in kind but shifted in purpose. The operator reads QA findings, addresses issues, and advances.

### Operator workflow for addressing QA findings

*(Decision from Q5: No automated remediation loop. No backward pipeline traversal.)*

1. QA writes `05_qa.md` with findings
2. Operator reads findings at `fine_tuning`
3. Operator uses `radio` to fix what needs fixing
4. Operator edits `05_qa.md` to record what they did
5. Operator ticks the checkbox: `- [x] Ready to advance to Cleanup`
6. Cleanup session (which runs build, lint, tests) serves as the re-verification pass

**Power-user escape hatch:** If the operator wants a fresh QA opinion after substantial fixes, they can manually edit `stage:` in `state.yml` back to `ai_qa` and run `drive` again. The new guard rule denies *agent* writes to `state.yml`, but the file remains the operator's to edit. Document this in `docs/pipeline.md` as an escape hatch, not as the normal flow.

There is no CLI affordance for moving a task backward through the pipeline. `--retry` (Workstream A, Fix 4) recovers a task that *failed* at a stage; it does not rewind one that completed successfully, and nothing in the codebase walks `STAGE_ORDER` in reverse.

---

## Lap 7: Decision

**Stage**: `cleanup_ready` produces `06_decision.md`, then the task parks at `need_decision`

The existing cleanup session (docs pass, build/lint/test) additionally writes `06_decision.md`: a checklist of everything that must be verified **after deploy** before the task can be closed.

### What the decision checklist contains

Items are derived from the actual work, not a boilerplate template. Sources:

- `00_objective.md` — the original intent
- `03_plan.md` — acceptance criteria
- `05_qa.md` — risks and known limitations

Every item must be concretely checkable: what to look at, where, and what "good" looks like.

### Checklist enforcement

*(Decision from Q2: Enforce all checkboxes.)*

`tryAdvance` verifies that every `- [ ]` checkbox in `06_decision.md` is ticked before accepting the completion marker. The decision checklist is the entire point of the stage — letting the operator skip items defeats its purpose.

If the operator genuinely wants to close with unticked items, they can delete the line or replace it with a note explaining why it was skipped.

This teaches `validation.ts` one new rule: all checkboxes ticked in the decision file, scoped only to `need_decision`. No other stage's behavior changes.

### Completion checkbox

`06_decision.md` ends with: `- [ ] Ready to advance to Done`

The task moves to `done` only after this is ticked (and all checklist items above it are also ticked).

---

## Operator Workflow: Execution through Decision

The full operator flow from execution onward:

```
1. Run `drive`         → Execution completes, task parks at `ai_qa`
                          Hint: "Task #4 is ready for QA — run 'vibe-racer drive' to start the QA lap."

2. Run `drive`         → QA session runs, writes `05_qa.md`, task parks at `fine_tuning`

3. Read `05_qa.md`     → Review findings, use `radio` to fix issues, edit `05_qa.md`
   Tick checkbox       → "Ready to advance to Cleanup"

4. Run `drive`         → Cleanup session runs, writes `06_decision.md`, task parks at `need_decision`

5. Deploy              → (Outside vibe-racer — no deploy automation)

6. Work checklist      → Tick items in `06_decision.md` as verified post-deploy
   Tick final checkbox → "Ready to advance to Done"

7. Run `drive`         → Task moves to `done`
```

---

## Trivial Tasks

*(Decision from Q3: Trivial tasks run QA and decision like every other task.)*

The `trivial` flag remains a front-half concept only. It skips product and design laps, and nothing else.

**Trivial task pipeline:**
```
objective → plan → execute → QA → fine-tuning → cleanup → decision → done
```

**Rationale:** A trivial task has a thin plan and a narrow diff — precisely the situation where an unverified "done" slips through unnoticed. The QA lap on a small diff is correspondingly small. Keeping trivial tasks on the full back half also avoids adding new branches in `handleExecute` and `handleDone` on a flag whose plumbing Workstream A is already rewriting.

---

## Pipeline Naming

*(Decision from Q4: Keep calling them laps. Update the headline to seven.)*

All documentation — README, tagline, docs site, `docs/pipeline.md` — updates from "five laps" to "seven laps." The two new laps are Lap 6 (QA) and Lap 7 (Decision). No new vocabulary (no "scrutineering," no "parc fermé").

**Updated tagline:** "Seven laps from objective to shipped code — you call the pit stops."

**Updated lap table:**

| Lap | Race engineer role | Output |
|---|---|---|
| 1. Objective review | Product Designer | Product questions |
| 2. Product review | Product Designer | Product spec + design questions |
| 3. Design review | Software Architect | Design spec + plan questions |
| 4. Plan review | Software Engineer | Implementation plan + execution playbook |
| 5. Execute | Software Engineer | Working code, milestone by milestone |
| 6. QA | QA Engineer | QA report |
| 7. Decision | Release Manager | Post-deploy checklist |

---

## Radio Personas at New Stages

*(Decision from Q6)*

### `fine_tuning` — Senior QA Engineer

Update the existing `fine_tuning` entry in `CHAT_PERSONA_MAP` and `CHAT_ROLE_DESCRIPTIONS`. The persona is a **Senior QA Engineer** who has read `05_qa.md` and can help the operator:
- Understand the issues found
- Prioritize which findings to address
- Guide fixes via `radio`

The role description should reference QA findings, not "tweak execution output."

### `need_decision` — Release Manager

New entry. The persona is a **Release Manager** who has read `06_decision.md` and can help the operator:
- Work through the post-deploy checklist
- Explain what to verify and how
- Decide whether an item can be waived

Both personas have access to the full plan directory for context.

---

## Engineering Skills (Workstream B)

### Wiring

Built-in per-lap defaults, overridable per-lap in `.vibe-racer.yml`:

```yaml
skills:
  objective: [...]
  product:   [...]
  design:    [...]
  plan:      [...]
  execute:   [...]
  qa:        [...]
  decision:  [...]
```

### Session changes

- `settingSources` changes from `["project"]` to include user-scope settings where account skills resolve
- `Skill` is added to every handler's `ALLOWED_TOOLS`
- The tool guard makes a deliberate decision about `Skill` rather than falling through to default-allow

### Graceful degradation

A configured skill that the operator does not have **warns at load and is dropped from the prompt**. It does not fail the lap. A lap with zero matching skills still completes normally.

### Default skill discovery

The default skill names are not known at product time. The design/plan laps must enumerate what is installed on the account and map each lap to the skills that fit.

---

## state.yml Corruption Fix (Workstream A)

### Fix 1: Deny agent writes to `state.yml`

New guard rule in `guard.ts`, placed *before* the existing review-stage rule (Rule 4). Applies at every stage — review, execution, QA, and cleanup.

### Fix 2: Harden `setError`

`setError` in `store.ts` must survive an unparseable `state.yml`. Salvage `title`/`created` when possible; write a valid `stage: error` record when not.

### Fix 4: Make `drive --retry` work

`--retry` is broken today and both new stages depend on it. It widens `drive`'s eligibility filter to tasks in `error` (`drive.ts`) but never restores a runnable stage, so `dispatch("error", ctx)` is called and throws `No handler for state: error`. `setError` cannot help: `withErrorHandling` passes it a *handler name* (`"execute"`, `"design-review"`, `"done"`), and `writeState` only copies `error_stage` into `prev` when it is a valid `Stage` — which a handler name never is. So `prev` is always `null` on an error record.

The fix is to record the stage instead of the handler name, then restore it on retry. Recovery re-runs the failed stage from the top; there is no mid-stage resume.

### Fix 3: Validate on write

`writeState` validates before serializing, so bad state surfaces at the write that caused it rather than the next read.

### Trivial fast-path re-plumbing

The objective-review prompt currently instructs the agent to write `state.yml` for trivial tasks. Once the guard lands, this becomes an instruction to trigger a denial. The trivial fast-path must be re-plumbed: the agent signals triviality through an artifact (e.g., writing `03_plan_questions.md` instead of `01_product_questions.md`), and the handler reads that signal and calls `store.ts` to set `trivial: true`.

### Post-fix cleanup

Delete `vibe-racer-fix.md` from the repo root once the work lands.

---

## Configuration Changes

### `.vibe-racer.yml`

New optional `skills` key with per-lap skill arrays.

### `pitwall`

Renders both new stages (`ai_qa`, `need_decision`) in the stage display.

### `drive`

- Prints a hint after execution completes: `Task #N is ready for QA — run 'vibe-racer drive' to start the QA lap.`
- Names the right file and checkbox for `fine_tuning` (`05_qa.md`) and `need_decision` (`06_decision.md`).

---

## Edge Cases and Error Recovery

| Scenario | Behavior |
|---|---|
| QA session fails mid-run | Task enters `error` with `error_stage: ai_qa`. `drive --retry` restores that stage and re-runs QA from scratch. |
| Cleanup session fails before writing `06_decision.md` | Task enters `error` with `error_stage: cleanup_ready`. `drive --retry` restores that stage and re-runs the full cleanup session. |
| Task sits in `error` from a pre-fix release, where `error_stage` holds a handler name rather than a stage | `--retry` cannot resolve a stage. `drive` reports the recorded `error_stage` and tells the operator to set `stage:` in `state.yml` by hand. No crash. |
| Operator ticks decision completion with unticked checklist items | `tryAdvance` rejects advancement. Operator must tick all items, delete lines, or add skip notes. |
| Agent attempts to write `state.yml` at any stage | Guard denies the write. Denial is logged to `.vibe-racer/audit.log`. Session continues. |
| `state.yml` is corrupted when `setError` is called | `setError` writes a valid `stage: error` record, salvaging `title`/`created` if possible. |
| Configured skill is missing from operator's account | Warning at session start. Skill is dropped from the prompt. Lap completes normally. |
| Existing task with old stage order | `next` field self-heals on next write. `pitwall` renders the task using whatever stage it has. |
| Operator wants to re-run QA after fixes | Power-user: manually edit `state.yml` to set `stage: ai_qa`, then `drive`. Documented but not a primary workflow. |

---

## Scope Boundaries

### In scope

- Two new stages (`ai_qa`, `need_decision`), their handlers, prompts, and guard treatment
- `05_qa.md` and `06_decision.md` generation
- Per-lap skill configuration, defaults, and prompt integration across all seven laps
- The three fixes from `vibe-racer-fix.md` plus trivial fast-path re-plumbing
- Checklist enforcement in `tryAdvance` for `need_decision`
- A working `drive --retry`: error records carry a real stage, and retry restores and re-dispatches it
- Updated `pitwall` stage display, `drive` hints, `radio` personas
- Docs: README, CLAUDE.md, pipeline docs, configuration docs, CHANGELOG
- Regression tests including the three named in `vibe-racer-fix.md`

### Out of scope

- Automated remediation of QA findings
- Deploy automation of any kind
- Re-running QA in a loop until clean
- CLI command to move a task backward through the pipeline. Fixing `--retry` restores the stage a task *failed at*, which is not the same as rewinding a successfully completed stage
- Mid-stage resume: retry re-runs the failed stage from the beginning
- Changes to the existing five laps' outputs beyond skill references
- Local web dashboard and other backlog items

---

## Acceptance Criteria

1. A task driven end to end produces seven documents (`00_objective.md` through `06_decision.md`) and reaches `done` only after the operator ticks the decision checkbox.
2. `05_qa.md` reports at least one honest negative finding on a task where something is genuinely incomplete — verified by seeding a task with a deliberately unmet acceptance criterion.
3. `06_decision.md` items trace to the objective, the plan's acceptance criteria, and the risks recorded in `05_qa.md`.
4. An agent `Write` or `Edit` targeting `state.yml` is denied at a review stage, an execution stage, and the new QA stage, and the denial is recorded in `.vibe-racer/audit.log`.
5. `setError` on a plan directory whose `state.yml` is unparseable writes a valid `stage: error` record instead of throwing.
6. The trivial fast-path still works without the agent writing `state.yml`.
7. Configured skills appear in the relevant lap's prompt; an unconfigured or missing skill produces a warning and a lap that still completes.
8. `pitwall` renders both new stages; `drive` names the right file and checkbox for each.
9. `tryAdvance` at `need_decision` rejects advancement when checklist items in `06_decision.md` are unticked.
10. `drive --retry` on a task in `error` restores the failed stage and re-dispatches its handler, for a failure in any stage including `ai_qa` and `cleanup_ready`. A task whose `error_stage` is not a valid stage produces an actionable message rather than `No handler for state: error`.
11. Docs describe the full seven-lap pipeline with no stale five-lap references, and `vibe-racer-fix.md` is deleted from the repo root.
