# Execution Playbook: `vibe-racer fasten`

> **Task**: #2 — Add a consolidate function
> **Stage**: Execution
> **Date**: 2026-04-15

---

## Execution Order

1. **M1** — Extract `createPlanFolder()` (pure refactor, zero behavior change)
2. **M2** — Analysis runner (new module, isolated)
3. **M3** — CLI command + integration (wires M1 + M2 together)

---

## Step-by-Step Protocol

For each milestone:

1. Read the milestone section in `03_plan.md`
2. Implement all tasks in order
3. Run `npm run typecheck` — fix any type errors
4. Run `npm run lint` — fix any lint errors
5. Run `npm run test` — all tests (new + existing) must pass
6. Commit with message: `vibe-racer: {milestone description} for #2`
7. Update the execution status table below
8. Proceed to the next milestone immediately

---

## Rules

- **One milestone at a time** — complete M1 before starting M2
- **Always commit** — every milestone ends with a passing build, tests, and a commit
- **No skipping tests** — `npm run test`, `npm run typecheck`, and `npm run lint` must all pass before committing
- **Follow the plan** — implement exactly what's specified in `03_plan.md`, no more, no less
- **Reuse existing code** — do not create parallel implementations of anything that already exists
- **Delete what you replace** — when refactoring `new.ts`, remove the inlined logic entirely
- **Match conventions** — new code must follow the patterns documented in the plan (naming, mocking, file structure)

---

## Execution Status

| Milestone | Name | Status | Commit | Notes |
|---|---|---|---|---|
| M1 | Extract `createPlanFolder()` | `done` | — | — |
| M2 | Analysis runner | `pending` | — | — |
| M3 | CLI command + integration | `pending` | — | — |

---

## Milestone Summary

### M1: Extract `createPlanFolder()`

| Item | Detail |
|---|---|
| New files | `src/state/plan-folder.ts`, `tests/state/plan-folder.test.ts` |
| Modified files | `src/cli/new.ts` |
| Key export | `createPlanFolder(options: CreatePlanOptions): CreatedPlan` |
| Validation | All existing tests pass (especially `tests/cli/cli.test.ts`), new unit tests pass |
| Commit message | `vibe-racer: extract createPlanFolder helper for #2` |

### M2: Analysis Runner

| Item | Detail |
|---|---|
| New files | `src/claude/fasten.ts`, `tests/claude/fasten.test.ts`, `tests/fixtures/fasten-with-findings.md`, `tests/fixtures/fasten-empty.md` |
| Modified files | None |
| Key export | `runFastenAnalysis(cwd: string): Promise<FastenAnalysisResult>` |
| Validation | New unit tests pass, typecheck passes |
| Commit message | `vibe-racer: add fasten analysis runner for #2` |

### M3: CLI Command + Integration

| Item | Detail |
|---|---|
| New files | `src/cli/fasten.ts`, `tests/cli/fasten.test.ts`, `tests/cli/fasten-integration.test.ts` |
| Modified files | `src/cli/index.ts`, `tests/cli/cli.test.ts` |
| Key export | `fastenCommand(opts: { force?: boolean }): Promise<void>` |
| Validation | All tests pass, `--help` shows `fasten`, typecheck + lint clean |
| Commit message | `vibe-racer: add fasten CLI command for #2` |

---

## Stack / Technology Reference

| Technology | Version / Usage |
|---|---|
| TypeScript | ES modules (`type: "module"` in package.json) |
| Node.js | >= 20 |
| Commander.js | CLI argument parsing — `wrapAction()` pattern |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` — `query()` via `runAndStream()` |
| YAML | `yaml` package — `stringify()` for state files |
| Zod | Schema validation for `state.yml` |
| Vitest | Test runner — `vi.mock()`, `vi.fn()`, `describe/it/expect` |
| tsup | Build tool — compiles `src/` to `dist/` |
| chalk | Terminal colors in logger |

---

# Complete

- [x] Ready to advance to Execution
