# Execution Playbook for #3: fasten-2026-04-16

> **Role**: Senior Software Engineer
> **Date**: 2026-04-16

---

## Execution Order

1. **M1**: Safe deletes — remove deprecated label API, dead config helpers, unused links module
2. **M2**: Un-export internals + test refactors — remove `export` from 13 internal symbols, rewrite tests through public APIs

## Step-by-Step Protocol

### For each milestone:

1. Read the milestone section in `03_plan.md`
2. Execute each numbered task in order
3. After each source file change, run `npm run typecheck` to catch import breakage immediately
4. After each test file change, run `npm run test` to verify the specific test suite
5. When all tasks in the milestone are done, run the full validation suite:
   ```bash
   npm run typecheck && npm run test && npm run lint && npm run build
   ```
6. Commit with a descriptive message
7. Update the execution status table below

## Rules

- **One milestone at a time** — complete M1 before starting M2
- **Always commit** — each milestone ends with a commit
- **Run continuously** — do not pause between milestones
- **Test after every file** — catch breakage immediately, not at the end
- **No new features** — this is a cleanup task; do not add functionality
- **Delete completely** — no commented-out code, no backwards-compatibility shims, no "kept for reference"

## Execution Status

| Milestone | Name | Status | Commit | Notes |
|-----------|------|--------|--------|-------|
| M1 | Safe deletes | `pending` | — | 3 source files + 2 deletions |
| M2 | Un-export internals + test refactors | `pending` | — | 8 source files + 5 test files |

## Milestone Summary

| Milestone | Source files changed | Test files changed | Symbols removed/un-exported |
|-----------|---------------------|--------------------|-----------------------------|
| M1 | `states.ts`, `loader.ts`, delete `links.ts` | Delete `links.test.ts`, update `states.test.ts` | 9 symbols deleted |
| M2 | `operations.ts`, `secrets.ts`, `store.ts`, `validation.ts`, `plan-folder.ts`, `advancement.ts`, `fasten.ts`, `machine.ts` | `operations.test.ts`, `secrets.test.ts`, `store.test.ts`, `validation.test.ts`, `machine.test.ts` | 13 exports removed |

## Stack / Technology Reference

| Tool | Command | Purpose |
|------|---------|---------|
| TypeScript | `npm run typecheck` | Type checking (`tsc --noEmit`) |
| Vitest | `npm run test` | Unit tests |
| ESLint | `npm run lint` | Linting |
| tsup | `npm run build` | Production build |

---

# Complete

- [ ] Ready to advance to Execution
