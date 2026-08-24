# Execution Playbook: Add QA Step (#4)

> **Stage**: `ai_plan_review`
> **Date**: 2026-08-24

---

## Execution Order

```
M1 Schema + State Machine
 └─> M2 Trivial Fast-Path Re-Plumb
      └─> M3 Guard Hardening + Error Recovery
           └─> M5 QA Handler + Decision Extension
                └─> M6 Docs + Cleanup

M4 Skills Module (independent of M2/M3, depends on M1)
 └─> M5 (also depends on M4)
```

Sequential execution: M1 -> M2 -> M3 -> M4 -> M5 -> M6.

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
- **No skipping.** Execute milestones in dependency order. M4 may be done after M1 but before M3 only if M2 is also done.
- **Tests are mandatory.** Each milestone specifies test requirements. They must pass before commit.
- **Follow the plan.** The implementation plan (`03_plan.md`) is the source of truth for what each milestone contains. Do not add scope.

---

## Execution Status

| Milestone | Name | Status | Commit | Notes |
|---|---|---|---|---|
| M1 | Schema + State Machine | `pending` | | |
| M2 | Trivial Fast-Path Re-Plumb | `pending` | | |
| M3 | Guard Hardening + Error Recovery | `pending` | | |
| M4 | Skills Module | `pending` | | |
| M5 | QA Handler + Decision Extension | `pending` | | |
| M6 | Docs + Cleanup | `pending` | | |

---

## Milestone Summary

### M1: Schema + State Machine
- Add `ai_qa` and `need_decision` to `STAGES` enum (16 total)
- Update `AGENT_STAGES`, `STAGE_QUESTIONS_FILE`, `STAGE_NEXT_NAME`
- Stage order regression tests
- **Files**: `src/state/schema.ts`, `src/pipeline/states.ts`, `tests/state/schema.test.ts`, `tests/pipeline/states.test.ts` (new)

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
- `--retry` restores stage from `error_stage`
- **Files**: `src/claude/guard.ts`, `src/claude/session.ts`, `src/state/store.ts`, `src/pipeline/handlers/safe-wrapper.ts`, `src/pipeline/machine.ts`, `src/cli/drive.ts`, `tests/claude/guard.test.ts`, `tests/state/store.test.ts`, `tests/pipeline/safe-wrapper.test.ts`, `tests/cli/drive.test.ts`

### M4: Skills Module
- New `src/claude/skills.ts` with `resolveSkills()`, `partitionSkills()`
- `settingSources: ["project", "user"]`
- Probe query for skill discovery
- `buildSkillsSection()` prompt builder
- Config schema: add `skills` key
- **Files**: `src/claude/skills.ts` (new), `src/claude/session.ts`, `src/claude/prompts.ts`, `src/config/schema.ts`, `tests/claude/skills.test.ts` (new), `tests/claude/session.test.ts`

### M5: QA Handler + Decision Extension
- `handleQa` writes `05_qa.md` with adversarial prompt
- `handleDone` extended to write `06_decision.md`, park at `need_decision`
- `handleExecute` advances to `ai_qa` instead of `fine_tuning`
- `validateDecisionChecklist()` in validation
- Checklist enforcement in `tryAdvance` for `need_decision`
- Radio personas for `fine_tuning` (updated) and `need_decision` (new)
- Register `handleQa` in machine
- **Files**: `src/pipeline/handlers/qa.ts` (new), `src/pipeline/handlers/done.ts`, `src/pipeline/handlers/execute.ts`, `src/pipeline/machine.ts`, `src/pipeline/validation.ts`, `src/state/advancement.ts`, `src/claude/prompts.ts`, `src/cli/drive.ts`, `src/cli/pitwall.ts`, `tests/pipeline/handlers/qa.test.ts` (new), `tests/pipeline/validation.test.ts` (new), `tests/state/advancement.test.ts`, `tests/cli/pitwall.test.ts`, `tests/claude/prompts.test.ts`

### M6: Docs + Cleanup
- Update README, CLAUDE.md, docs/how-it-works.md, docs/pipeline.md, docs/commands.md, docs/configuration.md
- Add CHANGELOG entry
- Delete `vibe-racer-fix.md`
- **Files**: `README.md`, `CLAUDE.md`, `docs/*.md`, `CHANGELOG.md`, `vibe-racer-fix.md` (delete)

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
| @anthropic-ai/claude-code | (project version) | Claude Code SDK |
| simple-git | (project version) | Git operations |

---

# Complete

- [ ] Ready to advance to Execution
