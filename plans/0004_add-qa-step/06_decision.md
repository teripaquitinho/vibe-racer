# Post-Deploy Decision Checklist: Add QA Step (#4)

> **Stage**: `need_decision`
> **Date**: 2026-08-25

Every item below must be verified **after the branch lands on main** before this task can be considered delivered. Each item is traced to its source: an acceptance criterion (AC), a residual risk (R), or a QA finding (ISSUE).

---

- [x] **M6 docs completed before merge.** QA found 12 stale "five laps" references across 8 files, no CHANGELOG entry, no `docs/security.md` update, no `docs/configuration.md` skills section, and no `CLAUDE.md` update. All M6 tasks (plan tasks 1-15) must be done and the stale-reference grep must return zero rows before this branch merges. *(Source: QA ISSUE 1, ISSUE 2, ISSUE 3, ISSUE 4, ISSUE 5, ISSUE 6, ISSUE 7, ISSUE 8, ISSUE 9 — AC11)*

- [x] **`vibe-racer-fix.md` deleted from repo root.** The file (175 lines) still exists. It must be deleted in the M6 commit per the plan (M6 task 15). Verify with `ls vibe-racer-fix.md` returning "No such file." *(Source: AC9, plan M6 task 15)*

- [x] **`package.json` description and `src/cli/index.ts` --help say "seven laps."** These ship to npm and terminal output. Run `node dist/index.js --help` and confirm "seven laps" appears, not "five laps." *(Source: QA ISSUE 9 — AC11, plan M6 tasks 2-3)*

- [ ] **End-to-end pipeline produces seven documents (`00_objective.md` through `06_decision.md`).** Drive a test task from `need_objective` to `done`. Confirm all seven files exist in the plan directory. Confirm the task reaches `done` only after the operator ticks the decision checkbox in `06_decision.md`. *(Source: AC1)*

- [ ] **QA lap finds honest negatives on incomplete work.** Run `handleQa` against the `tests/fixtures/incomplete-task/` fixture (seeded gap: `multiply()` in `src/sample.ts` lacks JSDoc). Confirm `05_qa.md`'s "What doesn't" section names the missing JSDoc — not a vague finding. Record the verbatim finding. *(Source: AC2 — QA ISSUE 10, QA Deviation D2)*

- [x] **`scripts/verify-ac2.mjs` exits non-zero when it cannot run verification.** Currently exits 0 on import failure, giving false confidence. Fix the script or run AC2 manually and record the result in `04_execute.md` M5a Notes. *(Source: QA ISSUE 10, Deviation D3)*

- [x] **`06_decision.md` items trace to objective, plan ACs, and QA risks.** This checklist itself satisfies AC3. Verify every item cites its source. *(Source: AC3)*

- [x] **Guard denies `Write`/`Edit` to any `state.yml` under `plans_dir` at review, execution, and QA stages.** Run the guard test suite: `npm run test -- tests/claude/guard.test.ts`. All Rule 0 tests pass. Denial is recorded in `.vibe-racer/audit.log`. *(Source: AC4)*

- [x] **`setError` on a plan directory with corrupt `state.yml` writes a valid `stage: error` record without throwing.** Run: `npm run test -- tests/state/store.test.ts`. All five `setError` cases pass, including the `next: ai_plan` regression from `vibe-racer-fix.md`. *(Source: AC5)*

- [x] **Trivial fast-path works without the agent writing `state.yml`.** The handler detects triviality via `03_plan_questions.md` file presence and sets `trivial: true` itself. Run: `npm run test -- tests/pipeline/handlers/objective-review.test.ts`. *(Source: AC6)*

- [ ] **Configured skills appear in every lap's prompt; missing skills warn and degrade.** Run: `npm run test -- tests/claude/skills.test.ts`. Confirm `LAP_BY_STAGE` covers all 7 agent stages. Configure a nonexistent skill name in `.vibe-racer.yml` and drive a task — confirm the warning appears in output and the lap completes. *(Source: AC7)*

- [x] **`pitwall` renders `ai_qa` under agent tasks and `need_decision` under human tasks. `drive` names the right file and checkbox for each new stage.** Run: `npm run test -- tests/cli/pitwall.test.ts tests/cli/drive.test.ts`. *(Source: AC8)*

- [x] **`tryAdvance` at `need_decision` rejects advancement when any checklist item (including indented items) is unticked.** Run: `npm run test -- tests/state/advancement.test.ts tests/pipeline/validation.test.ts`. Confirm `incomplete_checklist` result and that the completion marker is unchecked. *(Source: AC9)*

- [x] **`--retry` restores the failed stage from `error_stage` and dispatches exactly once.** A legacy handler-name `error_stage` prints an actionable message instead of throwing `No handler for state: error`. Run: `npm run test -- tests/cli/drive.test.ts`. *(Source: AC10)*

- [x] **Full test suite green, count only goes up.** Baseline: 27 files / 336 tests. Post-change: 31 files / 427 tests (per QA). Run `npm run build && npm run typecheck && npm run test && npm run lint` — all must pass. *(Source: plan "Continuous Verification")*

- [x] **Backward compatibility: existing tasks in `plans/0001`-`0003` still parse and render in `pitwall`.** Old `state.yml` files with `next: fine_tuning` (computed under the old stage order) must not throw on `readState`. Run `vibe-racer pitwall` and confirm all tasks render. *(Source: objective "Constraints" section)*

---

## Accepted Residual Risks

Each risk below is a deliberate scope decision documented in the plan. Sign off that you accept each one.

- [x] **R1: `Bash` can still write `state.yml`.** Rule 0 covers `Write`/`Edit` only. `echo ... > plans/NNNN/state.yml` and `sed -i` via `Bash` are unblocked at `ready_to_execute`, `ai_qa`, and `cleanup_ready`. Accepted because: the `vibe-racer-fix.md` incident was a `Write` call, no prompt instructs shell-writing `state.yml`, and extending the Bash command parser is a larger change than this task should carry. AC4 is scoped to `Write`/`Edit` accordingly. *(Source: plan "Accepted residual risks" R1, M3 task 3 "Known limitation")*

- [x] **R2: `settingSources: ["project", "user"]` widens the trust boundary.** User-scope settings carry hooks, permissions, MCP servers, and `additionalDirectories` into sessions running `permissionMode: "bypassPermissions"` with `canUseTool` as the only enforcement. Today's measured benefit is one plugin skill (`frontend-design`) that no default mapping uses. Verify `docs/security.md` documents this widening before signing off. *(Source: plan "Accepted residual risks" R2, M4 spike finding 2)*

- [x] **R3: The cleanup session is not write-jailed.** ~~Cleanup and decision sessions are not write-jailed.~~ **Half of this risk was closed rather than accepted.** `cleanup_ready` is still not in `PLAN_JAILED_STAGES`, because the cleanup session legitimately edits docs across the repo — that half stands, and is accepted. The decision session no longer inherits whole-repo write access: it opts into Rule 4a via `jailToPlanDir`, a per-session guard flag added because stage alone cannot separate two sessions sharing one stage. It remains restricted to `allowedTools: ["Read", "Glob", "Grep", "Write"]` — no `Edit`, no `Bash`. Verified by unit tests at three layers (guard rule, session pass-through, handler wiring); not yet exercised by a live cleanup lap. *(Source: plan "Accepted residual risks" R3, M5b task 3)*

- [ ] **R4: `handleDone` does not gate on build/lint/test results.** The cleanup session's build, lint, and test runs are prose instructions in `donePrompt`, not verified gates. The session may skip them or report false success. Do not rely on the cleanup lap as a re-verification pass. *(Source: plan "Accepted residual risks" final note, M5b task 3)*

---

## Verification log

Run on 2026-08-25 at `a0ca305` + cleanup commit `fb83983`, on branch `vibe-racer/0004_add-qa-step`.

**Ticked — verified by command:**

- M6 docs: AC11 grep returns 0 rows.
- `vibe-racer-fix.md`: `ls` -> "No such file or directory". Deleted in `0407f12`; both fixes it documented verified present first (guard Rule 0 at `guard.ts:312`, `setError` salvage at `store.ts:40`).
- Seven laps in shipped strings: `node dist/index.js --help` prints "seven laps"; `package.json` description matches.
- `verify-ac2.mjs`: zero `process.exit(0)` calls remain; the import-failure path exits 1.
- Source citations: 20 of 20 checklist items carry a `(Source: ...)` trace.
- Rule 0: 6 named Rule 0 tests pass (review, execution, and `ai_qa` stages, plus symlinked `/tmp` and the outside-`plans_dir` allow case). Denials route through `appendAuditEntry` at `guard.ts:291`. 73 guard tests pass.
- `setError`: 7 cases pass, including the `next: ai_plan` regression and the case where the salvaged record itself fails `stateSchema.parse`. The item said five; there are seven.
- Trivial fast-path: 4 tests pass; detection is by `03_plan_questions.md` presence, agent writes no state.
- `pitwall` / `drive` rendering: 15 tests pass.
- `tryAdvance` at `need_decision`: 35 tests pass across advancement and validation, covering indented items and the marker unchecking.
- `--retry`: 6 tests pass, including the legacy handler-name `error_stage` message and dispatch-exactly-once.
- Full suite: build, typecheck, lint clean. 31 files / 434 tests, up from the 427 QA recorded and the 336 baseline.
- Backward compatibility: `pitwall --all` renders all four tasks (#1 `need_objective`, #2 and #3 `done`, #4 `need_decision`). No task on disk actually carries the old computed `next: fine_tuning`, so that case was exercised synthetically: a hand-written old-format `state.yml` parses through `readState` without throwing.

**Left unticked — needs a live pipeline run (spends tokens), operator's call:**

- End-to-end seven-document run (AC1). Needs a task driven `need_objective` -> `done`.
- AC2 fixture run. Real-run evidence from this task's own QA lap is recorded verbatim in `04_execute.md` M5a Notes; the fixture run itself has not been executed.
- Skills (AC7), second half only. The unit half passes (12 tests, `LAP_BY_STAGE` covers all 7 agent stages); driving a lap with a deliberately bogus skill name to see the warning has not been done.

**Left unticked — acceptance decisions, not verifications:** R1 through R4. R2's precondition is met: `docs/security.md` now has a "Setting Sources" section documenting the widened trust boundary.

# Complete

- [ ] Ready to advance to Done
