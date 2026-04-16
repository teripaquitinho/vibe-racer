# Implementation Plan for #3: fasten-2026-04-16

> **Role**: Senior Software Engineer
> **Date**: 2026-04-16

---

## Implementation Strategy

Two milestones, matching the two-commit strategy from Q4. Milestone 1 removes all high-confidence dead code (no test impact). Milestone 2 un-exports internal symbols and refactors tests to use public APIs only. This order ensures Milestone 1 is trivially safe and independently shippable, while Milestone 2 groups all test-touching changes into a single atomic commit.

## Milestone Overview

| Milestone | Name | Key Output | Dependencies |
|-----------|------|------------|--------------|
| M1 | Safe deletes | Remove deprecated label API, dead config helpers, unused links module | None |
| M2 | Un-export internals + test refactors | Remove `export` from internal symbols, rewrite tests through public APIs | M1 |

---

## Milestone 1: Safe Deletes

### Goal

Remove all high-confidence dead code identified in the objective (safe items 1-5) plus the confirmed-dead `buildShareLink` module (review item 1).

### Existing code reused

- No new code written. This milestone is purely deletions.

### Tasks

1. **`src/pipeline/states.ts`** — Delete lines 1-57 (the entire label-based API block + migration comment):
   - Delete `LabelDefinition` interface (lines 1-5)
   - Delete `LABELS` array (lines 7-23)
   - Delete `AGENT_ACTIONABLE` set (lines 25-32)
   - Delete `isAgentActionable` function (lines 34-36)
   - Delete `isviberacerLabel` function (lines 38-40)
   - Delete `LABEL_ORDER` (lines 42-44)
   - Delete `nextLabel` function (lines 46-50)
   - Delete `previousLabel` function (lines 52-56)
   - Delete migration comment on line 58
   - The file should start with the `import { STAGES, type Stage }` line (current line 60)

2. **`tests/pipeline/states.test.ts`** — Delete all test blocks that reference the removed label API:
   - Delete `describe("isAgentActionable")` (4 tests)
   - Delete `describe("isviberacerLabel")` (2 tests)
   - Delete `describe("nextLabel")` (3 tests)
   - Delete `describe("previousLabel")` (3 tests)
   - Delete the `LABELS` import and any other removed-symbol imports
   - Keep all `describe` blocks for stage-based API (`isAgentStage`, `isHumanStage`, `nextStage`, `previousStage`, `STAGE_QUESTIONS_FILE`)

3. **`src/config/loader.ts`** — Delete dead functions and import:
   - Delete `import { execSync } from "child_process"` (line 2)
   - Delete `parseRepoUrl` function (lines 30-41)
   - Delete `detectProjectInfo` function (lines 43-61)
   - File retains: `findProjectRoot` and `loadConfig` only

4. **`src/utils/links.ts`** — Delete the entire file

5. **`tests/utils/links.test.ts`** — Delete the entire file

6. Run validation: `npm run typecheck && npm run test && npm run lint && npm run build`

### Test requirements

- All existing stage-based tests in `states.test.ts` still pass
- No TypeScript errors from removed imports
- Zero test files reference deleted symbols
- `npm run build` produces clean output

---

## Milestone 2: Un-export Internals + Test Refactors

### Goal

Remove `export` keyword from 13 internal symbols (review items 2-15) and rewrite all tests that directly imported those symbols to go through public APIs.

### Existing code reused

- `scanFiles` (public API in `src/git/secrets.ts`) — tests rewritten to use this instead of `checkFileName`/`checkFileContent`
- `dispatch` (public API in `src/pipeline/machine.ts`) — tests rewritten to use this instead of `hasHandler`
- `checkoutBranch` (public API in `src/git/operations.ts`) — tests rewritten to exercise `getCurrentBranch`/`branchExists` behavior through this
- `updateStage` / `setError` (public API in `src/state/store.ts`) — tests rewritten to use these instead of `writeState`
- `validateAnswers` (public API in `src/pipeline/validation.ts`) — tests rewritten to use this instead of `validateAnswersFromString`
- Existing `scanFiles` describe block (4 tests in `secrets.test.ts`) serves as the template for rewritten tests

### Genuinely new code

- None. All changes are removing `export` keywords and restructuring test assertions.

### Tasks

#### 2a. `src/git/operations.ts` — un-export 3 symbols (review items 3-5)

- Line 72: `export async function getCurrentBranch` → `async function getCurrentBranch`
- Line 76: `export async function branchExists` → `async function branchExists`
- Line 21: `export class SecretDetectedError` → `class SecretDetectedError`

#### 2b. `tests/git/operations.test.ts` — rewrite 3 tests

- Delete `getCurrentBranch` and `branchExists` imports
- Delete `describe("getCurrentBranch")` block (1 test) — this behavior is implicitly tested by `checkoutBranch` tests (which verify branch switching)
- Delete `describe("branchExists")` block (2 tests) — this behavior is implicitly tested by `checkoutBranch` tests (which call `git.branchLocal()` internally)
- Keep all other describe blocks unchanged

#### 2c. `src/git/secrets.ts` — un-export 2 symbols (review items 6-7)

- Line 25: `export function checkFileName` → `function checkFileName`
- Line 35: `export function checkFileContent` → `function checkFileContent`

#### 2d. `tests/git/secrets.test.ts` — rewrite 16 tests through `scanFiles`

- Remove `checkFileName` and `checkFileContent` imports; keep only `scanFiles` and `SecretMatch` (from the public API)
- **Rewrite `describe("checkFileName")` (9 tests) as `describe("scanFiles — filename detection")`:**
  - Each test creates a temp file path and calls `scanFiles([path])`
  - Assert `matches.length === 1` and `matches[0].reason` contains "Filename matches" for flagged names
  - Assert `matches.length === 0` for clean filenames
  - Use `vi.spyOn(fs, 'readFileSync')` to prevent actual file reads (mock returns clean content or throws)
- **Rewrite `describe("checkFileContent")` (7 tests) as `describe("scanFiles — content detection")`:**
  - Each test mocks `readFileSync` to return the target content string
  - Pass a non-sensitive filename (e.g., `config.js`) to avoid filename-match short-circuit
  - Assert `matches[0].reason` contains "Content matches" for flagged patterns
  - Assert `matches.length === 0` for clean content
  - For "skips large files": mock returns a buffer > 100KB
  - For "handles missing files": mock throws `ENOENT`
- Template: follow the existing `describe("scanFiles")` block's pattern for mock setup and assertions

#### 2e. `src/state/store.ts` — un-export 1 symbol (review item 8)

- Line 15: `export function writeState` → `function writeState`

#### 2f. `tests/state/store.test.ts` — rewrite 6 tests

- Remove `writeState` import; keep `readState`, `updateStage`, `setError`
- **Merge `describe("writeState")` (1 test) into `describe("updateStage")`** — test that `updateStage` creates `state.yml` with updated timestamp (same assertion, just via public API)
- **Merge `describe("writeState prev/next computation")` (5 tests) into `describe("updateStage prev/next")`** — each test calls `updateStage(planPath, stage)` then reads the file and asserts `prev`/`next` fields. For the error-stage cases, use `setError` instead.

#### 2g. `src/pipeline/validation.ts` — un-export 2 symbols (review items 9-10)

- Line 4: `export interface ValidationResult` → `interface ValidationResult`
- Line 16: `export function validateAnswersFromString` → `function validateAnswersFromString`

#### 2h. `tests/pipeline/validation.test.ts` — rewrite 9 tests

- Remove `validateAnswersFromString` import; keep `validateAnswers`
- **Rewrite `describe("validateAnswersFromString")` as `describe("validateAnswers")`:**
  - Each test writes a temp markdown file with the test content, then calls `validateAnswers(filePath)`
  - All 9 test cases preserved with identical assertions (`.complete`, `.unanswered`)
  - Use `tmp` dir or `vi.spyOn(fs.promises, 'readFile')` to mock file content

#### 2i. `src/state/plan-folder.ts` — un-export 2 symbols (review items 11-12)

- Line 8: `export interface CreatePlanOptions` → `interface CreatePlanOptions`
- Line 18: `export interface CreatedPlan` → `interface CreatedPlan`

#### 2j. `src/state/advancement.ts` — un-export 1 symbol (review item 13)

- Line 13: `export interface AdvancementResult` → `interface AdvancementResult`

#### 2k. `src/claude/fasten.ts` — un-export 1 symbol (review item 14)

- Line 5: `export interface FastenAnalysisResult` → `interface FastenAnalysisResult`

#### 2l. `src/pipeline/machine.ts` — un-export 2 symbols (review items 2, 15)

- Line 10: `export type HandlerFn` → `type HandlerFn`
- Line 29: `export function hasHandler` → `function hasHandler`

#### 2m. `tests/pipeline/machine.test.ts` — rewrite 3 tests

- Remove `hasHandler` import; keep `dispatch`
- **Rewrite `describe("hasHandler")` as `describe("dispatch — handler coverage")`:**
  - "returns true for agent states" → verify `dispatch(state, ctx)` does not throw for each agent state (mock the handler to be a no-op)
  - "returns false for human states" → verify `dispatch(state, ctx)` throws `No handler for state` for human states
  - "returns false for unknown states" → verify `dispatch(state, ctx)` throws for unknown strings

#### 2n. Run validation: `npm run typecheck && npm run test && npm run lint && npm run build`

### Test requirements

- All rewritten tests pass and cover the same edge cases
- No test file imports any un-exported symbol
- `npm run typecheck` passes — no broken imports
- `npm run lint` passes — no unused import warnings
- `npm run build` clean

---

## Dependency Graph

```
M1 (Safe deletes)
  └── M2 (Un-export internals + test refactors)
```

Strictly sequential. M2 depends on M1 because M1 removes the label API from `states.ts` and its tests, which must be done before M2 touches the same test file structure.

---

## Test Strategy

| Layer | What | Tool |
|-------|------|------|
| Type safety | No broken imports/types after removals | `npm run typecheck` |
| Unit tests | All rewritten tests pass, same edge-case coverage | `npm run test` |
| Lint | No unused imports, no lint regressions | `npm run lint` |
| Build | Clean production build | `npm run build` |

Run the full suite (`npm run typecheck && npm run test && npm run lint && npm run build`) at the end of each milestone. Run `npm run test` incrementally after each file change within M2 to catch issues early.
