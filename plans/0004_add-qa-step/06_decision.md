# Post-Deploy Decision Checklist: Add QA Step (#4)

> **Stage**: `need_decision`
> **Date**: 2026-08-25

Every item below must be verified **after the branch lands on main** before this task can be considered delivered. Each item is traced to its source: an acceptance criterion (AC), a residual risk (R), or a QA finding (ISSUE).

---

- [x] **M6 docs completed before merge.** QA found 12 stale "five laps" references across 8 files, no CHANGELOG entry, no `docs/security.md` update, no `docs/configuration.md` skills section, and no `CLAUDE.md` update. All M6 tasks (plan tasks 1-15) must be done and the stale-reference grep must return zero rows before this branch merges. *(Source: QA ISSUE 1, ISSUE 2, ISSUE 3, ISSUE 4, ISSUE 5, ISSUE 6, ISSUE 7, ISSUE 8, ISSUE 9 — AC11)*

- [x] **`vibe-racer-fix.md` deleted from repo root.** The file (175 lines) still exists. It must be deleted in the M6 commit per the plan (M6 task 15). Verify with `ls vibe-racer-fix.md` returning "No such file." *(Source: AC9, plan M6 task 15)*

- [x] **`package.json` description and `src/cli/index.ts` --help say "seven laps."** These ship to npm and terminal output. Run `node dist/index.js --help` and confirm "seven laps" appears, not "five laps." *(Source: QA ISSUE 9 — AC11, plan M6 tasks 2-3)*

- [ ] **End-to-end pipeline produces seven documents (`00_objective.md` through `06_decision.md`).** Drive a test task from `need_objective` to `done`. Confirm all seven files exist in the plan directory. Confirm the task reaches `done` only after the operator ticks the decision checkbox in `06_decision.md`. *(Source: AC1)*

- [x] **QA lap finds honest negatives on incomplete work.** Run `handleQa` against the `tests/fixtures/incomplete-task/` fixture (seeded gap: `multiply()` in `src/sample.ts` lacks JSDoc). Confirm `05_qa.md`'s "What doesn't" section names the missing JSDoc — not a vague finding. Record the verbatim finding. *(Source: AC2 — QA ISSUE 10, QA Deviation D2)*

- [x] **`scripts/verify-ac2.mjs` exits non-zero when it cannot run verification.** Currently exits 0 on import failure, giving false confidence. Fix the script or run AC2 manually and record the result in `04_execute.md` M5a Notes. *(Source: QA ISSUE 10, Deviation D3)*

- [x] **`06_decision.md` items trace to objective, plan ACs, and QA risks.** This checklist itself satisfies AC3. Verify every item cites its source. *(Source: AC3)*

- [x] **Guard denies `Write`/`Edit` to any `state.yml` under `plans_dir` at review, execution, and QA stages.** Run the guard test suite: `npm run test -- tests/claude/guard.test.ts`. All Rule 0 tests pass. Denial is recorded in `.vibe-racer/audit.log`. *(Source: AC4)*

- [x] **`setError` on a plan directory with corrupt `state.yml` writes a valid `stage: error` record without throwing.** Run: `npm run test -- tests/state/store.test.ts`. All five `setError` cases pass, including the `next: ai_plan` regression from `vibe-racer-fix.md`. *(Source: AC5)*

- [x] **Trivial fast-path works without the agent writing `state.yml`.** The handler detects triviality via `03_plan_questions.md` file presence and sets `trivial: true` itself. Run: `npm run test -- tests/pipeline/handlers/objective-review.test.ts`. *(Source: AC6)*

- [x] **Configured skills appear in every lap's prompt; missing skills warn and degrade.** Run: `npm run test -- tests/claude/skills.test.ts`. Confirm `LAP_BY_STAGE` covers all 7 agent stages. Configure a nonexistent skill name in `.vibe-racer.yml` and drive a task — confirm the warning appears in output and the lap completes. *(Source: AC7)*

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

- [x] **R4: `handleDone` does not gate on build/lint/test results.** The cleanup session's build, lint, and test runs are prose instructions in `donePrompt`, not verified gates. The session may skip them or report false success. Do not rely on the cleanup lap as a re-verification pass. *(Source: plan "Accepted residual risks" final note, M5b task 3)*

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

**AC7 second half — verified by live session, 2026-08-25.** A fixture project configured
`skills: { qa: ["security-review", "definitely-not-a-real-skill-xyz"] }` and ran a one-turn
session at stage `ai_qa`. Output, verbatim:

```
Guard: path-jail to ./<plan>  ·  tools: [Read]  ·  bash: 18 commands blocked
Skills not found (dropped from prompt): definitely-not-a-real-skill-xyz
OK
Session complete — 1 turns, $0.0417
```

The warning named only the bogus entry, so `security-review` resolved and stayed in the
prompt, and the lap completed. A minimal one-turn session was used rather than a full lap:
the probe, `partitionSkills`, and the warning all run before the session body, so the same
code path is exercised at a fraction of the cost.

**AC2 — verified by live fixture run, 2026-08-25.** `npx tsx scripts/verify-ac2.mjs` built a
throwaway repo from `tests/fixtures/incomplete-task/` and ran `handleQa` against it
(16 turns, $0.2393). The QA report named the seeded gap precisely, verbatim from
`05_qa.md`:

> ### ISSUE 1 — `multiply()` has no JSDoc (AC1 FAIL, AC2 FAIL)
>
> `multiply()` (line 11) has no JSDoc block. The diff shows it was added bare [...]
> There is exactly 1 JSDoc block in the file but 2 exported functions [...]
> The plan's Task 2 ("Add JSDoc to `multiply()` in `src/sample.ts`") was not completed.

It also found a second defect the fixture does not document as seeded — the fixture's
execution log claims milestone M1 landed at commit `abc1234`, which does not exist:

> ### ISSUE 2 — 04_execute.md references a non-existent commit
>
> `$ git log --oneline | grep abc1234` -> (no output). Commit `abc1234` does not exist in
> the repository history. The actual commits on this branch are `def5d5f` and `7f40e1f`.
> The execution log is inaccurate.

Finding the planted gap proves the prompt works. Verifying a commit claim nobody asked it
to check is the stronger signal.

**The run also exposed a latent coupling, now fixed in the script.** `handleQa` calls
`updateStage(ctx.planPath, ...)` with a *relative* path, which resolves against
`process.cwd()` rather than `ctx.cwd`. Every handler does this; only `advancement.ts` passes
an absolute path. In the CLI the two directories are always identical (`drive` sets
`ctx.cwd = process.cwd()`), so nothing is broken in normal use — but any caller driving a
handler against a different directory hits `ENOENT` on `state.yml` after the session has
already run and been paid for. `verify-ac2.mjs` now `chdir`s into the fixture. Making the
handlers pass absolute paths is the real fix and is not in scope here.

**Left unticked — needs a live pipeline run (spends tokens), operator's call:**

- End-to-end seven-document run (AC1). Needs a task driven `need_objective` -> `done`. Note that task #4 itself traversed every lap and produced all seven documents; what an AC1 run adds is the final `need_decision` -> `done` hop and a race where every lap runs the new code from the start.

**Residual risks — reviewed one by one and signed off 2026-08-25:**

- R1 accepted as-is. The gap is `Write`/`Edit`-only; Bash redirects to `state.yml` remain possible at `ready_to_execute`, `ai_qa`, and `cleanup_ready`.
- R2 accepted. Narrower than the risk text implies: `["project"]` was already loaded on `main`, so this task's only new exposure is the operator's own `~/.claude/settings.json`. `docs/security.md` documents the boundary, which was R2's stated precondition.
- R3 **half closed rather than accepted** — the decision session is now jailed via `jailToPlanDir` (`fa77976`). The cleanup half stands accepted: that session must reach docs repo-wide.
- R4 accepted. The unverified window is the cleanup lap only; QA runs build/lint/tests with pasted output one lap earlier. Deliberately not fixed here — a `verify:` key in `.vibe-racer.yml` would let a raced repo specify arbitrary commands that vibe-racer executes outside the guard, which needs a design lap rather than a call at the sign-off gate.

**Two pre-existing defects surfaced while closing R3, both out of scope, neither fixed:**

- Rule 2 compares `realpathSync`-resolved file paths against an unresolved `cwd`. With `cwd=/tmp/repo` on macOS (`/tmp` -> `/private/tmp`), `Write /tmp/repo/README.md` is denied "path outside project directory" while `Write /tmp/repo/src/index.ts` is allowed — the difference is only whether the file's parent directory exists. Fails closed, so it is a usability bug rather than a hole. Rule 0 already does this correctly with `realpathIfExists`.
- `docs/security.md` states `/tmp` is an allowed write target, twice. The code allows `os.tmpdir()`, which on macOS is `/var/folders/.../T`, not `/tmp`.

# Complete

- [ ] Ready to advance to Done
