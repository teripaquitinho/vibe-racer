# Execution Playbook: Add QA Step (#4)

> **Stage**: `ai_plan_review`
> **Date**: 2026-08-24

---

## Execution Order

**Strictly sequential, in table order: M1 → M2 → M3 → M4 → M5a → M5b → M6.**

The milestone loop picks the first row still marked `pending` in the Execution Status table below, so the table *is* the order. Do not reorder.

```
M1 Schema + State Machine
 └─> M2 Trivial Fast-Path Re-Plumb     (must precede M3 — see below)
      └─> M3 Guard Hardening + Error Recovery
           └─> M4 Skills Module
                └─> M5a QA Handler + Execute Rewiring
                     └─> M5b Decision Stage + Checklist Enforcement
                          └─> M6 Docs + Cleanup
```

M4 has no logical dependency on M2 or M3 — only on M1 — but it still runs fourth, because sequential execution is simpler than tracking a partial order for no gain.

**M2 before M3 is not negotiable.** M3 lands Rule 0, which denies the agent's `state.yml` write — currently the only way `trivial` gets set. Landing M3 first leaves the trivial fast-path silently broken for a milestone, and the test suite will not catch it (`objective-review.test.ts` mocks `readState` and seeds `trivial: true` directly, so it never exercises the agent's write).

**M5 was split into M5a and M5b.** The original M5 carried 17 tasks across 9 source files and 5 test files — by far the largest milestone, and the one most exposed to a mid-session failure. `handleExecute`'s loop has no iteration cap, so an over-large milestone that stalls burns a whole session with nothing committed. The seam is natural: M5a is self-contained (QA end to end), and M5b needs only `05_qa.md` to exist.

**One ordering change from the previous revision:** the `STAGE_QUESTIONS_FILE[fine_tuning]` remap moved out of M1 into M5a. In M1 it pointed every task finishing execution at an `05_qa.md` that nothing writes until M5a — four milestones during which any task reaching `fine_tuning` was stranded. The map entry now lands in the same commit as the handler that produces the file.

---

## Step-by-Step Protocol

For each milestone:

1. Read the milestone section in `03_plan.md`
2. Implement all tasks in order
3. Write the tests specified
4. Run verification: `npm run build && npm run typecheck && npm run test && npm run lint`
5. Fix any failures
6. Commit: `vibe-racer: <milestone description> for #4`
7. Update the execution status table below

---

## Rules

- **One milestone at a time.** Do not start M(N+1) until M(N) is committed and green.
- **Always commit.** Every milestone ends with a commit containing passing build, typecheck, tests, and lint.
- **No skipping, no reordering.** Take the first `pending` row in the Execution Status table. M2 must be committed before M3 begins, and M5a before M5b.
- **Coverage only goes up.** Baseline is 27 test files / 336 tests, all green. A milestone that keeps the suite green by deleting or skipping a test is not done.
- **Tests are mandatory.** Each milestone specifies test requirements. They must pass before commit.
- **Follow the plan.** The implementation plan (`03_plan.md`) is the source of truth for what each milestone contains. Do not add scope.

---

## Execution Status

| Milestone | Name | Status | Commit | Notes |
|---|---|---|---|---|
| M1 | Schema + State Machine | `done` | | |
| M2 | Trivial Fast-Path Re-Plumb | `done` | | |
| M3 | Guard Hardening + Error Recovery | `pending` | | |
| M4 | Skills Module | `pending` | | |
| M5a | QA Handler + Execute Rewiring | `pending` | | AC2 fixture result goes here |
| M5b | Decision Stage + Checklist Enforcement | `pending` | | |
| M6 | Docs + Cleanup | `pending` | | |

---

## Post-Execution Bootstrap — read this before running `drive`

**This task modifies the pipeline that is executing it.** `drive` loads the current code at process start, so the entire milestone loop — all seven milestones — runs on the *old* `handleExecute`, even after M5a rewrites it on disk. That is fine while the loop is running. It becomes a problem the moment it ends.

The old `handleExecute` finishes by rewriting `04_execute.md`'s checkbox and setting `stage: fine_tuning`. But M5a has already changed `STAGE_QUESTIONS_FILE[fine_tuning]` on disk from `04_execute.md` to `05_qa.md`. So the next `drive` — now running the new code — finds the task at `fine_tuning`, looks for `05_qa.md`, and does not find it, because nothing has ever written one. `tryAdvance` returns `no_questions_file`, and `drive` prints a hint pointing at a file that does not exist. **The task is stranded with no forward path.**

(Moving the remap from M1 to M5a narrows the window from four milestones to zero for *other* tasks, but it does not remove this one. The loop still runs old code to completion after M5a has landed.)

### The fix — build, then one manual edit, after M6 commits

```
0. Rebuild, so the next `drive` actually runs the new code:
       npm run build
   package.json declares "bin": {"vibe-racer": "./dist/index.js"}. If you invoke a
   globally installed or linked `vibe-racer`, it runs dist/ — WITHOUT this step it is
   still the pre-task build, `ai_qa` is not a known stage, and step 3 dies with
   `No handler for state: ai_qa`. If you are unsure what is on your PATH, sidestep it
   entirely and run step 3 as:  npm run dev -- drive

1. Confirm all seven milestones show `done` in the Execution Status table,
   and that `plans/0004_add-qa-step/05_qa.md` does NOT already exist.

2. Edit plans/0004_add-qa-step/state.yml by hand:
       stage: fine_tuning   ->   stage: ai_qa
   Leave every other field alone; `prev`/`next` are recomputed on the next write.

3. Run `vibe-racer drive`   (or `npm run dev -- drive`).
```

That dispatches `handleQa` under the new code, which writes the first real `05_qa.md` — this task QA'ing itself with the QA lap it just built — and parks at `fine_tuning` with a checkbox that now points at a file that exists.

**If step 3 reports `No handler for state: ai_qa`**, the running binary is stale. Go back to step 0.

This is the same power-user escape hatch documented in `01_product.md` and `docs/pipeline.md`: `state.yml` is denied to the *agent* by Rule 0, but it remains the operator's file to edit. Nothing about this bootstrap is a workaround for a defect; it is the unavoidable cost of a pipeline rebuilding itself mid-flight.

---

## Milestone Summary

### M1: Schema + State Machine
- Add `ai_qa` and `need_decision` to `STAGES` enum (16 total)
- Update `AGENT_STAGES`, `STAGE_NEXT_NAME`, and `STAGE_QUESTIONS_FILE[need_decision]`
- **Do NOT remap `STAGE_QUESTIONS_FILE[fine_tuning]` here** — that moves to M5a, alongside the handler that writes `05_qa.md`
- Stage order regression tests, including `nextStage("need_plan") === "ai_plan_review"` (the guard from `vibe-racer-fix.md`, which does not exist today)
- **Files**: `src/state/schema.ts`, `src/pipeline/states.ts`, `tests/state/schema.test.ts` (extend), `tests/pipeline/states.test.ts` (**extend — already exists, 74 lines**)

### M2: Trivial Fast-Path Re-Plumb
- Agent signals triviality via `03_plan_questions.md` file presence
- Handler detects artifact and sets `trivial: true`
- Remove `state.yml` write instruction from prompt
- Export `writeState` from `store.ts`
- **Files**: `src/claude/prompts.ts`, `src/pipeline/handlers/objective-review.ts`, `src/state/store.ts`, `tests/pipeline/handlers/objective-review.test.ts`

### M3: Guard Hardening + Error Recovery
- Rule 0: deny `state.yml` writes under `plans_dir`
- Split `REVIEW_STAGES` into `PLAN_JAILED_STAGES` + `BASH_BLOCKED_STAGES`
- Explicit `Skill` allow in guard
- `setError` hardening (survive corrupt `state.yml`)
- Validate-on-write in `writeState`
- `withErrorHandling` passes stage, not handler name
- `--retry` restores stage from `error_stage` — **replacing** the existing single `dispatch(task.stage, ctx)` call, not preceding it (otherwise it dispatches twice)
- Rule 0 must realpath `plansRoot` and use a trailing separator, or it silently never fires under symlinked paths (macOS `/tmp`)
- `plansDir` comes from `loadConfig(cwd).plans_dir`, never a hardcoded `"plans"`
- `setError`'s final write is wrapped in try/catch — validate-on-write lands in the same milestone and would otherwise give it a new way to throw
- Drive-by: pass `ctx.cwd` to `commitAll` in `safe-wrapper.ts` so the error-path commit is secret-scanned
- **Files**: `src/claude/guard.ts`, `src/claude/session.ts`, `src/state/store.ts`, `src/pipeline/handlers/safe-wrapper.ts`, `src/pipeline/machine.ts`, `src/cli/drive.ts`, `tests/claude/guard.test.ts` (extend), `tests/state/store.test.ts` (**extend — 120 lines**), `tests/pipeline/safe-wrapper.test.ts` (extend), `tests/cli/drive.test.ts` (extend), `tests/claude/fasten.test.ts` (**no change needed — verified `objectContaining`, does not break**)

### M4: Skills Module
- **The spike is DONE — do not re-run it.** It was executed during the plan lap on 2026-08-24 and the result is recorded in `03_plan.md`. The probe works on a freshly constructed query (0.8–1.2s); take the probe path. The streaming-input fallback is not needed.
- New `src/claude/skills.ts` with `LAP_BY_STAGE`, `DEFAULT_SKILLS`, `resolveSkills()`, `partitionSkills()`
- **`LAP_BY_STAGE` is what wires all seven laps.** Deriving the lap from `stage` inside `runAndStream` means no handler needs a `lap` argument. Threading `lap` by hand through the six existing call sites was the previous approach and it reached only QA — AC7 would have failed for the other six laps.
- Verified defaults only: `execute: ["simplify"]`, `qa: ["security-review"]`, all other laps empty. These two names are confirmed present in `supportedCommands()` output. **Do not add unverified names** — `code-review`, `test-runner`, `tdd`, and `refactor` appear in earlier drafts and none of them are installed.
- `settingSources: ["project", "user"]` — buys exactly one skill today (`frontend-design`) and widens the trust boundary; carried as residual risk R2
- `buildSkillsSection()` prompt builder; probe failure degrades to persona-only rather than failing the lap
- Config schema: add `skills` key only — `repo`, `plans_dir`, `context` untouched
- `src/claude/fasten.ts` passes `lap: null` to opt out
- **Files**: `src/claude/skills.ts` (new), `src/claude/session.ts`, `src/claude/prompts.ts`, `src/config/schema.ts`, `src/claude/fasten.ts`, `tests/claude/skills.test.ts` (new), `tests/claude/session.test.ts`, `tests/claude/fasten.test.ts` (extend)

### M5a: QA Handler + Execute Rewiring
- `handleQa` writes `05_qa.md` with the adversarial prompt; passes `plansDir` and `maxTurns`; throws if the file is absent rather than advancing into a stranded state
- QA prompt gains a **diff scope** (`git diff --stat main...HEAD`, `git log --oneline main..HEAD`) — without it "What regressed" is unanswerable and the `security-review` skill has nothing branch-scoped to bite on
- `handleExecute` advances to `ai_qa` instead of `fine_tuning`, and the `04_execute.md` checkbox-rewriting block is deleted outright
- `STAGE_QUESTIONS_FILE[fine_tuning]` remap lands **here**, in the same commit as the handler that writes the file
- Register `handleQa` in `machine.ts`; radio persona for `fine_tuning` becomes Senior QA Engineer
- **AC2 fixture + verification script** — `tests/fixtures/incomplete-task/` (a *complete* fixture: objective, plan, playbook, and a `src/sample.ts` with a seeded undocumented export) plus `scripts/verify-ac2.mjs`, which builds a throwaway git repo so `git diff main...HEAD` genuinely contains the gap. Run it and paste the verbatim finding into this milestone's Notes column. If QA reports the fixture clean — or names the gap only vaguely — the prompt failed and **M5a is not done**.
- **Files**: `src/pipeline/handlers/qa.ts` (new), `src/pipeline/handlers/execute.ts`, `src/pipeline/states.ts`, `src/pipeline/machine.ts`, `src/claude/prompts.ts` (adds `PERSONAS.qaEngineer`), `tests/pipeline/handlers/qa.test.ts` (new), `tests/pipeline/handlers/execute.test.ts` (**new — none exists today**), `tests/pipeline/machine.test.ts` (**extend — 109 lines, needs a `qa.js` mock**), `tests/pipeline/states.test.ts` (extend), `tests/claude/prompts.test.ts` (extend), `tests/fixtures/incomplete-task/` (new), `scripts/verify-ac2.mjs` (new)

### M5b: Decision Stage + Checklist Enforcement
- `handleDone` extended: second session writes `06_decision.md`, **verifies it exists**, appends the checkbox, parks at `need_decision`. Full session contract — `allowedTools: ["Read","Glob","Grep","Write"]`, `stage: "cleanup_ready"`, `plansDir`, `maxTurns: 30` — not four bullets.
- `validateDecisionChecklist()` matches **indented** `- [ ]` lines too; the decision prompt still requires flat top-level items
- Checklist enforcement in `tryAdvance` for `need_decision`
- Radio persona for `need_decision` (Release Manager); `pitwall`/`drive` are verify-only
- **Residual risks R1–R3 must appear as named items in `06_decision.md`** (see `03_plan.md` → Accepted residual risks)
- **Files**: `src/pipeline/handlers/done.ts`, `src/pipeline/validation.ts`, `src/state/advancement.ts`, `src/claude/prompts.ts` (adds `PERSONAS.releaseManager`), `src/cli/drive.ts`, `src/cli/pitwall.ts`, `tests/pipeline/handlers/done.test.ts` (**new — none exists today**), `tests/pipeline/validation.test.ts` (**extend — 260 lines**), `tests/state/advancement.test.ts` (extend), `tests/cli/pitwall.test.ts` (extend), `tests/cli/drive.test.ts` (extend — AC8's hint half), `tests/claude/prompts.test.ts` (extend), `tests/state/schema.test.ts` (extend — backward compat)

### M6: Docs + Cleanup
- **The old file list could not satisfy AC11.** Stale five-lap references live in five files it never named, one of them a source file. The verified list is in `03_plan.md` M6.
- Update `README.md`, `package.json` (npm description), **`src/cli/index.ts`** (the `--help` string), `docs/index.md`, `docs/.vitepress/config.ts`, `docs/pipeline.md`, `docs/getting-started.md`, `docs/faq.md` (lap count, cost estimate, **and the `--retry` description M3 changed**), `docs/how-it-works.md`, `docs/commands.md`, `docs/configuration.md`, `CLAUDE.md` (personas, trivial fast-path mechanism, project structure, state.yml ownership)
- Add CHANGELOG entry covering all three workstreams plus `--retry`
- Delete `vibe-racer-fix.md` (175 lines) — here, not earlier, so M5a's QA lap can cross-reference it
- **Verification is a grep, not a read-through** — see `03_plan.md` M6 → Verification. It must return zero rows.
- **Files**: `README.md`, `package.json`, `src/cli/index.ts`, `CLAUDE.md`, `CHANGELOG.md`, `docs/index.md`, `docs/pipeline.md`, `docs/how-it-works.md`, `docs/getting-started.md`, `docs/faq.md`, `docs/commands.md`, `docs/configuration.md`, `docs/security.md` (**R2 belongs here**), `docs/.vitepress/config.ts`, `vibe-racer-fix.md` (delete)

---

## Stack / Technology Reference

| Technology | Version | Usage |
|---|---|---|
| Node.js | >= 20 | Runtime |
| TypeScript | (project version) | Type system |
| tsup | (project version) | Build |
| vitest | (project version) | Test framework |
| zod | (project version) | Schema validation |
| yaml | (project version) | YAML parse/stringify |
| commander | (project version) | CLI framework |
| @anthropic-ai/claude-agent-sdk | ^0.2.62 (0.2.101 installed) | Claude Agent SDK — `supportedCommands()`, `SettingSource` |
| simple-git | (project version) | Git operations |

---

# Complete

- [x] Ready to advance to Execution
