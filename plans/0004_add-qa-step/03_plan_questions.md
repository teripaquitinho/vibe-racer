# Plan Questions for #4: Add QA step

> **Role**: Senior Software Engineer
> **Stage**: `ai_design_review` → `need_plan`
> **Date**: 2026-08-24

---

## Build sequence and milestones

### Q1: In what order should the three workstreams be built, and how should they be sliced into milestones?

The workstreams touch overlapping files (`states.ts`, `guard.ts`, `prompts.ts`, `schema.ts`), so they cannot be developed in full isolation. The question is whether to build them in sequence (A → B → C), interleave them by layer (schema first for all three, then guard, then handlers), or group by risk.

**Answer:**
Build by risk, front-loading the changes most likely to break existing behavior:

1. **Milestone 1 — Schema + state machine** (`schema.ts`, `states.ts`): Add the two new stages, update all stage maps (`STAGE_QUESTIONS_FILE`, `STAGE_NEXT_NAME`, `AGENT_STAGES`), and add the `nextStage` regression tests. This is the foundation everything else depends on. Build and test pass at the end.

2. **Milestone 2 — Guard hardening** (`guard.ts`, `store.ts`): Rule 0 (deny `state.yml` writes), split `REVIEW_STAGES` into `PLAN_JAILED_STAGES` + `BASH_BLOCKED_STAGES`, `setError` hardening, validate-on-write. Run all existing guard tests plus the new ones. This is the highest-risk change (it modifies security enforcement for all stages), so it ships before anything depends on the new stages.

3. **Milestone 3 — Trivial fast-path + `--retry` fix** (`objective-review.ts`, `safe-wrapper.ts`, `drive.ts`): Re-plumb the trivial signal, fix `withErrorHandling` to pass stages instead of handler names, implement `--retry` restore logic. Tests for trivial path and retry.

4. **Milestone 4 — Skills module** (`skills.ts`, `session.ts`, `config/schema.ts`, `prompts.ts`): New module, session changes, config extension, prompt builder. Test with a mock `supportedCommands()` response.

5. **Milestone 5 — QA handler + decision extension** (`qa.ts`, `done.ts`, `machine.ts`, `validation.ts`, `prompts.ts`): The two new stages wired end to end. Depends on milestones 1–4. Includes `validateDecisionChecklist`, radio personas, `pitwall` rendering, `drive` hints.

6. **Milestone 6 — Docs + cleanup**: Update README, CLAUDE.md, `docs/pipeline.md`, `docs/how-it-works.md`, `docs/commands.md`, `docs/configuration.md`, CHANGELOG. Delete `vibe-racer-fix.md`.

---

## Testing approach

### Q2: How should the QA prompt's honesty requirement (AC2) be tested during development?

AC2 says: "`05_qa.md` reports at least one honest negative finding on a task where something is genuinely incomplete." This is a behavioral property of the prompt, not a unit-testable function. The question is how to verify it without running a full end-to-end task.

**Answer:**
Create a fixture task directory (`test/fixtures/incomplete-task/`) with a pre-built `03_plan.md` containing a clear acceptance criterion (e.g., "all exported functions have JSDoc") and a `04_execute.md` that claims completion but deliberately omits that criterion. Run `handleQa` against this fixture (using the real Claude session or a recorded response) and assert that `05_qa.md` contains a finding about the missing criterion. This is a manual verification step during development — add it to the plan's execution playbook as a named checkpoint, not an automated test. The unit tests cover the structural requirements (all six sections present, no empty "What doesn't" without evidence).

---

### Q3: Should the guard split (`PLAN_JAILED_STAGES` / `BASH_BLOCKED_STAGES`) be tested as new enforcement or as a behavioral no-op for existing stages?

The split is a refactor for existing review stages (their behavior does not change — they were already Bash-blocked via `allowedTools`) but introduces new enforcement (the guard now independently denies Bash at those stages). The question is whether tests should assert the old behavior or the new stricter behavior.

**Answer:**
Test the new enforcement. Write guard-level tests that call `canUseTool("Bash", ...)` at each review stage and assert `deny` — even though today the call would never reach the guard because `allowedTools` blocks it first. These tests document the intended invariant: review stages cannot run Bash, and the guard enforces it regardless of what `allowedTools` says. If a future handler accidentally adds Bash to a review stage's tool list, the guard catches it. This is the entire point of defense in depth — test the defense, not the accident of the current wiring.

---

## Deployment and backward compatibility

### Q4: How should the milestone that changes `handleExecute`'s advancement target (from `fine_tuning` to `ai_qa`) be tested against in-flight tasks?

A task currently sitting at `ready_to_execute` has `next: fine_tuning` in `state.yml`. After the code change, execution will advance to `ai_qa` instead. The `next` field self-heals on the next `writeState`, but there is a window where the stale `next` is visible to `pitwall`. The question is whether this needs explicit handling.

**Answer:**
No explicit handling needed — accept the window. `pitwall` reads `state.yml` and displays the `next` field, but the field is informational, not used for dispatch. `dispatch` reads `stage`, not `next`. The first `writeState` after the code change recomputes `next` correctly. Add one test: parse a `state.yml` written by the old code (with `next: fine_tuning` after `ready_to_execute`) and verify `readState` succeeds and `pitwall` renders without error. That is sufficient — the self-healing mechanism is already tested by the existing `writeState` tests.

---

## Execution playbook structure

### Q5: Should the execution playbook (`04_execute.md`) be structured as one milestone per file touched, one per workstream, or one per the milestone breakdown from Q1?

The plan milestone decomposition (Q1) groups by risk and dependency. The execution playbook milestones need not mirror them exactly — they could be finer (one per file) or coarser (one per workstream). The question is what granularity gives the milestone loop the best chance of clean per-milestone commits.

**Answer:**
Mirror the plan milestones from Q1 directly. Six milestones, one per plan milestone. The milestone loop already handles multi-file changes within a single milestone (it runs until the milestone marker flips from `pending` to `done`), so there is no advantage to splitting further. Coarser milestones (per workstream) risk too much work in a single session, increasing the chance of a mid-milestone failure that wastes compute. The Q1 breakdown is already ordered by dependency, which is exactly what the sequential milestone loop needs.

---

### Q6: Should `vibe-racer-fix.md` be deleted in the docs milestone or immediately after its fixes land?

The objective says "delete it once the work lands." The question is whether "lands" means "the code for the fixes is committed" (milestone 2–3) or "the entire task is done and docs are updated" (milestone 6). Deleting early removes a reference that the QA and decision laps might want to cross-check against.

**Answer:**
Delete it in milestone 6 (docs + cleanup), not when the fixes land. The QA session (milestone 5) benefits from having `vibe-racer-fix.md` available as a reference to verify the fixes were implemented correctly — it is one of the sources the QA prompt should cross-reference. Once the docs milestone updates all pipeline documentation and the QA report has been written, the file has served its purpose. The deletion is part of the cleanup, alongside updating CHANGELOG and removing stale five-lap references.

---

# Complete

- [ ] Ready to advance to Plan Review
