# Post-Deploy Decision Checklist: Add QA Step (#4)

> **Stage**: `need_decision`
> **Date**: 2026-08-25

Every item below must be verified **after the branch lands on main** before this task can be considered delivered. Each item is traced to its source: an acceptance criterion (AC), a residual risk (R), or a QA finding (ISSUE).

---

- [ ] **M6 docs completed before merge.** QA found 12 stale "five laps" references across 8 files, no CHANGELOG entry, no `docs/security.md` update, no `docs/configuration.md` skills section, and no `CLAUDE.md` update. All M6 tasks (plan tasks 1-15) must be done and the stale-reference grep must return zero rows before this branch merges. *(Source: QA ISSUE 1, ISSUE 2, ISSUE 3, ISSUE 4, ISSUE 5, ISSUE 6, ISSUE 7, ISSUE 8, ISSUE 9 — AC11)*

- [ ] **`vibe-racer-fix.md` deleted from repo root.** The file (175 lines) still exists. It must be deleted in the M6 commit per the plan (M6 task 15). Verify with `ls vibe-racer-fix.md` returning "No such file." *(Source: AC9, plan M6 task 15)*

- [ ] **`package.json` description and `src/cli/index.ts` --help say "seven laps."** These ship to npm and terminal output. Run `node dist/index.js --help` and confirm "seven laps" appears, not "five laps." *(Source: QA ISSUE 9 — AC11, plan M6 tasks 2-3)*

- [ ] **End-to-end pipeline produces seven documents (`00_objective.md` through `06_decision.md`).** Drive a test task from `need_objective` to `done`. Confirm all seven files exist in the plan directory. Confirm the task reaches `done` only after the operator ticks the decision checkbox in `06_decision.md`. *(Source: AC1)*

- [ ] **QA lap finds honest negatives on incomplete work.** Run `handleQa` against the `tests/fixtures/incomplete-task/` fixture (seeded gap: `multiply()` in `src/sample.ts` lacks JSDoc). Confirm `05_qa.md`'s "What doesn't" section names the missing JSDoc — not a vague finding. Record the verbatim finding. *(Source: AC2 — QA ISSUE 10, QA Deviation D2)*

- [ ] **`scripts/verify-ac2.mjs` exits non-zero when it cannot run verification.** Currently exits 0 on import failure, giving false confidence. Fix the script or run AC2 manually and record the result in `04_execute.md` M5a Notes. *(Source: QA ISSUE 10, Deviation D3)*

- [ ] **`06_decision.md` items trace to objective, plan ACs, and QA risks.** This checklist itself satisfies AC3. Verify every item cites its source. *(Source: AC3)*

- [ ] **Guard denies `Write`/`Edit` to any `state.yml` under `plans_dir` at review, execution, and QA stages.** Run the guard test suite: `npm run test -- tests/claude/guard.test.ts`. All Rule 0 tests pass. Denial is recorded in `.vibe-racer/audit.log`. *(Source: AC4)*

- [ ] **`setError` on a plan directory with corrupt `state.yml` writes a valid `stage: error` record without throwing.** Run: `npm run test -- tests/state/store.test.ts`. All five `setError` cases pass, including the `next: ai_plan` regression from `vibe-racer-fix.md`. *(Source: AC5)*

- [ ] **Trivial fast-path works without the agent writing `state.yml`.** The handler detects triviality via `03_plan_questions.md` file presence and sets `trivial: true` itself. Run: `npm run test -- tests/pipeline/handlers/objective-review.test.ts`. *(Source: AC6)*

- [ ] **Configured skills appear in every lap's prompt; missing skills warn and degrade.** Run: `npm run test -- tests/claude/skills.test.ts`. Confirm `LAP_BY_STAGE` covers all 7 agent stages. Configure a nonexistent skill name in `.vibe-racer.yml` and drive a task — confirm the warning appears in output and the lap completes. *(Source: AC7)*

- [ ] **`pitwall` renders `ai_qa` under agent tasks and `need_decision` under human tasks. `drive` names the right file and checkbox for each new stage.** Run: `npm run test -- tests/cli/pitwall.test.ts tests/cli/drive.test.ts`. *(Source: AC8)*

- [ ] **`tryAdvance` at `need_decision` rejects advancement when any checklist item (including indented items) is unticked.** Run: `npm run test -- tests/state/advancement.test.ts tests/pipeline/validation.test.ts`. Confirm `incomplete_checklist` result and that the completion marker is unchecked. *(Source: AC9)*

- [ ] **`--retry` restores the failed stage from `error_stage` and dispatches exactly once.** A legacy handler-name `error_stage` prints an actionable message instead of throwing `No handler for state: error`. Run: `npm run test -- tests/cli/drive.test.ts`. *(Source: AC10)*

- [ ] **Full test suite green, count only goes up.** Baseline: 27 files / 336 tests. Post-change: 31 files / 427 tests (per QA). Run `npm run build && npm run typecheck && npm run test && npm run lint` — all must pass. *(Source: plan "Continuous Verification")*

- [ ] **Backward compatibility: existing tasks in `plans/0001`-`0003` still parse and render in `pitwall`.** Old `state.yml` files with `next: fine_tuning` (computed under the old stage order) must not throw on `readState`. Run `vibe-racer pitwall` and confirm all tasks render. *(Source: objective "Constraints" section)*

---

## Accepted Residual Risks

Each risk below is a deliberate scope decision documented in the plan. Sign off that you accept each one.

- [ ] **R1: `Bash` can still write `state.yml`.** Rule 0 covers `Write`/`Edit` only. `echo ... > plans/NNNN/state.yml` and `sed -i` via `Bash` are unblocked at `ready_to_execute`, `ai_qa`, and `cleanup_ready`. Accepted because: the `vibe-racer-fix.md` incident was a `Write` call, no prompt instructs shell-writing `state.yml`, and extending the Bash command parser is a larger change than this task should carry. AC4 is scoped to `Write`/`Edit` accordingly. *(Source: plan "Accepted residual risks" R1, M3 task 3 "Known limitation")*

- [ ] **R2: `settingSources: ["project", "user"]` widens the trust boundary.** User-scope settings carry hooks, permissions, MCP servers, and `additionalDirectories` into sessions running `permissionMode: "bypassPermissions"` with `canUseTool` as the only enforcement. Today's measured benefit is one plugin skill (`frontend-design`) that no default mapping uses. Verify `docs/security.md` documents this widening before signing off. *(Source: plan "Accepted residual risks" R2, M4 spike finding 2)*

- [ ] **R3: Cleanup and decision sessions are not write-jailed.** `cleanup_ready` is not in `PLAN_JAILED_STAGES` because the cleanup session legitimately edits docs across the repo. The decision session inherits whole-repo write access to produce one file. Mitigated by restricting the decision session to `allowedTools: ["Read", "Glob", "Grep", "Write"]` — no `Edit`, no `Bash`. *(Source: plan "Accepted residual risks" R3, M5b task 3)*

- [ ] **R4: `handleDone` does not gate on build/lint/test results.** The cleanup session's build, lint, and test runs are prose instructions in `donePrompt`, not verified gates. The session may skip them or report false success. Do not rely on the cleanup lap as a re-verification pass. *(Source: plan "Accepted residual risks" final note, M5b task 3)*

# Complete

- [ ] Ready to advance to Done
