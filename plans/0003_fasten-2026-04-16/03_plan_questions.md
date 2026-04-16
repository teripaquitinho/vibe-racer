# Plan Questions for #3: fasten-2026-04-16

> **Role**: Senior Software Engineer
> **Stage**: `ai_objective_review` → `need_plan` (trivial fast-path)
> **Date**: 2026-04-16

---

## Deletion strategy

### Q1: Should all safe deletions be removed in a single commit or one commit per file?

The objective identifies 5 high-confidence deletions across 2 files, plus one confirmed-dead module (`buildShareLink`, see Q2 Category A′). We need to decide the commit granularity.

**Answer:**
One commit for all safe deletes — the 5 high-confidence items from the objective plus the confirmed-dead `buildShareLink` module (review item 1, see Q2 Category A′). They span 3 source files + 1 test file (`src/pipeline/states.ts`, `src/config/loader.ts`, `src/utils/links.ts`, `tests/utils/links.test.ts`). A single commit with a clear message like "remove deprecated label-based API, dead config helpers, and unused links module" keeps the git history clean without unnecessary noise. The commit is trivially revertible as a unit.

### Q2: For the 15 "needs review" items, what is the disposition of each category?

The objective groups 15 items but they fall into distinct categories: (a) unused modules/functions exported only for tests, (b) exports never imported anywhere including tests, (c) unused type exports inferred by callers. Each category warrants a different decision.

**Answer:**
- **Category A — functions exported only for tests** (items 2-4, 6-9): Remove the `export` keyword. Tests should exercise these through their public entry point instead. Mapping:
  - Item 2: `hasHandler` → test via `dispatch` (`src/pipeline/machine.ts`)
  - Item 3: `getCurrentBranch` → test via `checkoutBranch` (`src/git/operations.ts`)
  - Item 4: `branchExists` → test via `checkoutBranch` (`src/git/operations.ts`)
  - Item 6: `checkFileName` → test via `scanFiles` (`src/git/secrets.ts`)
  - Item 7: `checkFileContent` → test via `scanFiles` (`src/git/secrets.ts`)
  - Item 8: `writeState` → test via `updateStage` / `setError` (`src/state/store.ts`)
  - Item 9: `validateAnswersFromString` → test via `validateAnswers` (`src/pipeline/validation.ts`)

  Don't keep dead exports as test backdoors. **Heads-up on `secrets.test.ts`** (items 6-7): `checkFileName` and `checkFileContent` have ~25 granular edge-case tests (`.env.local`, oversized files, unreadable files, etc.) that are currently tested directly. Rewriting them through `scanFiles` is possible but more verbose — each case needs a tailored `mockReadFileSync` setup plus assertions on the `SecretMatch[]` array. Budget extra time here.
- **Category A′ — full deletion**: `buildShareLink` (item 1) — delete `src/utils/links.ts` **and** `tests/utils/links.test.ts` since the feature was never wired up and isn't on the roadmap.
- **Category B — type/interface exports never imported** (items 10-15): Remove the `export` keyword from all of them (`ValidationResult`, `CreatePlanOptions`, `CreatedPlan`, `AdvancementResult`, `FastenAnalysisResult`, `HandlerFn`). TypeScript infers these types at call sites; the interfaces remain in the file as documentation for anyone reading the source.
- **Category C — `SecretDetectedError` export** (item 5): Remove `export` only. The class is used internally by `commitAll`; callers catch generic `Error`, so the export is dead.

### Q3: Should tests that import now-unexported symbols be updated or deleted?

Several test files import internal functions (`checkFileName`, `checkFileContent`, `writeState`, `validateAnswersFromString`, `hasHandler`, `getCurrentBranch`, `branchExists`) that we're about to un-export. We need to decide how to handle the breakage.

**Answer:**
Update, not delete. For each broken test:
1. If the behavior is reachable through a public function in the same module, rewrite the test to call the public function instead.
2. If the test covers a meaningful edge case not covered by public-API tests, keep the test but refactor it to exercise the edge case through the public entry point.
3. Run `npm run test` after each file's changes to catch breakage immediately.

Do not simply delete test coverage — the underlying logic still needs to be tested, just through its public surface.

**Highest-effort refactor**: `secrets.test.ts` — the `checkFileName` describe block (9 cases) and `checkFileContent` describe block (7 cases) will need to be rewritten as `scanFiles` tests. The mocking setup already exists (`mockReadFileSync`), so the main work is restructuring assertions from `checkFileName(path) → string|null` to `scanFiles([path]) → SecretMatch[]`. The `scanFiles` describe block (4 existing cases) can serve as the template.

### Q4: What is the execution order — safe deletes first, then reviews, or interleaved by file?

We could process changes file-by-file (touching each file once) or in two passes (safe deletes first, then review items).

**Answer:**
Two commits, processed file-by-file within each commit to minimise context switching:

**Commit 1 — safe deletes** (high-confidence, no test impact):
1. `src/pipeline/states.ts` — delete label block + migration comment (safe items 1, 5)
2. `src/config/loader.ts` — delete `detectProjectInfo`, `parseRepoUrl`, `execSync` import (safe items 2-4)
3. `src/utils/links.ts` + `tests/utils/links.test.ts` — delete both files (review item 1, confirmed dead)

Run `npm run test && npm run typecheck` before committing.

**Commit 2 — un-exports + test refactors** (medium-confidence, requires test updates):
4. `src/git/operations.ts` — un-export `getCurrentBranch`, `branchExists`, `SecretDetectedError`; update `operations.test.ts` (review items 3-5)
5. `src/git/secrets.ts` — un-export `checkFileName`, `checkFileContent`; refactor `secrets.test.ts` (review items 6-7)
6. `src/state/store.ts` — un-export `writeState`; update `store.test.ts` (review item 8)
7. `src/pipeline/validation.ts` — un-export `validateAnswersFromString`, `ValidationResult`; update `validation.test.ts` (review items 9-10)
8. `src/state/plan-folder.ts` — un-export `CreatePlanOptions`, `CreatedPlan` (review items 11-12, no test impact)
9. `src/state/advancement.ts` — un-export `AdvancementResult` (review item 13, no test impact)
10. `src/claude/fasten.ts` — un-export `FastenAnalysisResult` (review item 14, no test impact)
11. `src/pipeline/machine.ts` — un-export `hasHandler`, `HandlerFn`; update `machine.test.ts` (review items 2, 15)

Run `npm run test && npm run typecheck` after each file, then full validation suite before committing.

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

- [x] Ready to advance to Plan Review
