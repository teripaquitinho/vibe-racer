# Plan Questions for #3: fasten-2026-04-16

> **Role**: Senior Software Engineer
> **Stage**: `ai_objective_review` → `need_plan` (trivial fast-path)
> **Date**: 2026-04-16

---

## Deletion strategy

### Q1: Should the 5 "safe to delete" items be removed in a single commit or one commit per file?

The objective identifies 5 high-confidence deletions across 2 files (`src/pipeline/states.ts` and `src/config/loader.ts`). We need to decide the commit granularity.

**Answer:**
One commit for all 5 safe-to-delete items. They are all high-confidence, tightly related (deprecated/dead code removal), and span only 2 files. A single commit with a clear message like "remove deprecated label-based API and dead config helpers" keeps the git history clean without unnecessary noise. The commit is trivially revertible as a unit.

### Q2: For the 15 "needs review" items, what is the disposition of each category?

The objective groups 15 items but they fall into distinct categories: (a) unused modules/functions exported only for tests, (b) exports never imported anywhere including tests, (c) unused type exports inferred by callers. Each category warrants a different decision.

**Answer:**
- **Category A — functions exported only for tests** (items 1-4, 6-9): Remove the `export` keyword. Tests should exercise these through their public API (`scanFiles`, `dispatch`, `updateStage`, `validateAnswers`). If any test breaks, refactor the test to use the public entry point — don't keep dead exports as test backdoors. Exception: `buildShareLink` (item 1) — delete the entire file `src/utils/links.ts` and its test since the feature was never wired up and isn't on the roadmap.
- **Category B — type/interface exports never imported** (items 10-15): Remove the `export` keyword from all of them (`ValidationResult`, `CreatePlanOptions`, `CreatedPlan`, `AdvancementResult`, `FastenAnalysisResult`, `HandlerFn`). TypeScript infers these types at call sites; the interfaces remain in the file as documentation for anyone reading the source.
- **Category C — `SecretDetectedError` export** (item 5): Remove `export` only. The class is used internally by `commitAll`; callers catch generic `Error`, so the export is dead.

### Q3: Should tests that import now-unexported symbols be updated or deleted?

Several test files import internal functions (`checkFileName`, `checkFileContent`, `writeState`, `validateAnswersFromString`, `hasHandler`, `getCurrentBranch`, `branchExists`) that we're about to un-export. We need to decide how to handle the breakage.

**Answer:**
Update, not delete. For each broken test:
1. If the behavior is reachable through a public function in the same module, rewrite the test to call the public function instead.
2. If the test covers a meaningful edge case not covered by public-API tests, keep the test but refactor it.
3. Run `npm run test` after each file's changes to catch breakage immediately.

Do not simply delete test coverage — the underlying logic still needs to be tested, just through its public surface.

### Q4: What is the execution order — safe deletes first, then reviews, or interleaved by file?

We could process changes file-by-file (touching each file once) or in two passes (safe deletes first, then review items).

**Answer:**
Process file-by-file to minimize context switching and reduce the chance of merge conflicts with concurrent work. Suggested file order:
1. `src/pipeline/states.ts` — delete label block + migration comment (safe items 1, 5)
2. `src/config/loader.ts` — delete `detectProjectInfo`, `parseRepoUrl`, `execSync` import (safe items 2-4)
3. `src/utils/links.ts` — delete entire file + its test (review item 1)
4. `src/git/operations.ts` — un-export `getCurrentBranch`, `branchExists`, `SecretDetectedError` (review items 3-5)
5. `src/git/secrets.ts` — un-export `checkFileName`, `checkFileContent` (review items 6-7)
6. `src/state/store.ts` — un-export `writeState` (review item 8)
7. `src/pipeline/validation.ts` — un-export `validateAnswersFromString`, `ValidationResult` (review items 9-10)
8. `src/state/plan-folder.ts` — un-export `CreatePlanOptions`, `CreatedPlan` (review items 11-12)
9. `src/state/advancement.ts` — un-export `AdvancementResult` (review item 13)
10. `src/claude/fasten.ts` — un-export `FastenAnalysisResult` (review item 14)
11. `src/pipeline/machine.ts` — un-export `hasHandler`, `HandlerFn` (review items 2, 15)

One commit per logical group: safe deletes, then all un-exports + test fixes.

### Q5: What validation should pass before considering this task complete?

We need to define the "done" checklist — what must be green before we ship.

**Answer:**
All four of these must pass with zero failures:
1. `npm run typecheck` — no type errors from removed exports or broken imports
2. `npm run test` — all tests pass (updated tests included)
3. `npm run lint` — no lint errors from unused imports or missing references
4. `npm run build` — clean build with no warnings related to changed files

No manual/visual testing needed — this is purely a code hygiene task with no runtime behavior change.

---

# Complete

- [ ] Ready to advance to Plan Review
