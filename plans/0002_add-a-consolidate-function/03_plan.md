# Implementation Plan: `vibe-racer fasten`

> **Task**: #2 — Add a consolidate function
> **Stage**: Plan Review
> **Date**: 2026-04-15

---

## Implementation Strategy

Build bottom-up: shared helper first, then the analysis runner, then the CLI command that wires them together. The refactor of `new` into the shared helper is milestone 1 because it's a zero-risk change with full test coverage already in place — any regression is caught immediately. The analysis runner (milestone 2) is independent of milestone 1 and could theoretically be built in parallel, but sequential execution keeps commits clean. The CLI command (milestone 3) is the integration point that depends on both.

This order minimizes risk: milestone 1 is a pure refactor (no new behavior), milestone 2 is isolated (no dependencies on plan folder creation), and milestone 3 is the only milestone that introduces user-visible behavior.

---

## Milestone Overview

| Milestone | Name | Key Output | Dependencies |
|---|---|---|---|
| M1 | Extract `createPlanFolder()` | `src/state/plan-folder.ts` + refactored `src/cli/new.ts` | None |
| M2 | Analysis runner | `src/claude/fasten.ts` with prompt + isEmpty detection | None |
| M3 | CLI command + integration | `src/cli/fasten.ts` registered in `index.ts` | M1, M2 |

---

## Milestone 1: Extract `createPlanFolder()`

### Goal

Extract plan folder creation logic from `src/cli/new.ts` into a shared helper `src/state/plan-folder.ts`. Refactor `new` to delegate to it. Zero behavior change — existing tests must pass unmodified.

### Existing code reused

- `src/cli/new.ts` — source of the logic being extracted (lines 12-43)
- `src/state/discovery.ts` — `getNextTaskNumber()` (already imported by `new.ts`)
- `src/pipeline/validation.ts` — `completionSection()`, `completionSectionChecked()` (already imported)
- `src/pipeline/states.ts` — `STAGE_NEXT_NAME` (already imported)
- `src/git/slug.ts` — `slugify()` (still used by `new.ts` for slug generation)

### Existing code extended

- `src/cli/new.ts` — refactored to call `createPlanFolder()` instead of inline logic

### Genuinely new

- `src/state/plan-folder.ts` — new file, but contains only logic moved from `new.ts` plus the `trivial` and `objectiveContent` options from the design spec

### Tasks

1. **Create `src/state/plan-folder.ts`** with the following interface:

   ```typescript
   export interface CreatePlanOptions {
     title: string;
     plansDir: string;
     slug: string;
     trivial?: boolean;
     objectiveContent?: string;
     checkboxLabel: string;
     checked?: boolean;
   }

   export interface CreatedPlan {
     taskNumber: number;
     folderName: string;
     planDir: string;
   }

   export function createPlanFolder(options: CreatePlanOptions): CreatedPlan
   ```

   Implementation:
   - Call `getNextTaskNumber(options.plansDir)` to get the next number
   - Build `folderName` as `${String(taskNumber).padStart(4, "0")}_${options.slug}`
   - `mkdirSync(planDir, { recursive: true })`
   - Write `00_objective.md`: use `options.objectiveContent ?? "> Write your objective here."` as body, append `completionSection(options.checkboxLabel)` or `completionSectionChecked(options.checkboxLabel)` based on `options.checked`
   - Write `state.yml` via `writeFileSync` with: `{ stage: "need_objective", title: options.title, trivial: options.trivial, created: new Date().toISOString() }`. Omit `trivial` key entirely when undefined (match existing `new` behavior).
   - Return `{ taskNumber, folderName, planDir }`

2. **Refactor `src/cli/new.ts`** to delegate to `createPlanFolder()`:

   ```typescript
   import { createPlanFolder } from "../state/plan-folder.js";
   import { slugify } from "../git/slug.js";
   import { STAGE_NEXT_NAME } from "../pipeline/states.js";

   export async function newCommand(title: string, opts: { desc?: string }): Promise<void> {
     const cwd = process.cwd();
     const config = loadConfig(cwd);
     const plansDir = path.join(cwd, config.plans_dir);
     const nextName = STAGE_NEXT_NAME.need_objective ?? "Next Stage";

     const { taskNumber, folderName } = createPlanFolder({
       title,
       plansDir,
       slug: slugify(title),
       objectiveContent: opts.desc,
       checkboxLabel: nextName,
       checked: Boolean(opts.desc),
     });

     const relPath = path.join(config.plans_dir, folderName);
     log.success(`Task #${taskNumber} created: ${relPath}`);
     // ... same terminal output as before
   }
   ```

   Remove: `mkdirSync`, `writeFileSync` calls, `getNextTaskNumber` import, `stringify` import, `TaskState` import, `completionSection`/`completionSectionChecked` imports.

3. **Verify**: Run `npm run test` — all existing tests (especially `tests/cli/cli.test.ts` and any `new` command tests) must pass unchanged. Run `npm run typecheck`.

### Test requirements

- **`tests/state/plan-folder.test.ts`** (new file):
  - Creates folder with correct `NNNN_slug` name
  - Writes `00_objective.md` with default body when no `objectiveContent` provided
  - Writes `00_objective.md` with custom content when `objectiveContent` provided
  - Writes unchecked checkbox when `checked` is false/undefined
  - Writes checked checkbox when `checked` is true
  - Writes `state.yml` with correct initial stage, title, and timestamps
  - Writes `state.yml` with `trivial: true` when option set
  - Does not include `trivial` key in `state.yml` when option is undefined
  - Returns correct `taskNumber`, `folderName`, `planDir`
  - Uses temp directory pattern from existing tests (`mkdtempSync` / `rmSync`)
- Existing `tests/cli/cli.test.ts` passes without modification (regression guard)

---

## Milestone 2: Analysis Runner

### Goal

Build `src/claude/fasten.ts` — the Claude session runner that executes the dead code analysis and returns structured output. This module is self-contained with no dependency on milestone 1.

### Existing code reused

- `src/claude/session.ts` — `runAndStream()` for executing the Claude session
- `src/claude/guard.ts` — `createToolGuard()` via `runAndStream`'s `stage` parameter (pass `"ai_objective_review"` with empty `taskPlanPath`)
- `src/claude/prompts.ts` — follows the template literal convention for prompt construction

### Existing code extended

None — this is a new runner that calls existing infrastructure.

### Genuinely new

- `src/claude/fasten.ts` — new file with hardcoded analysis prompt and isEmpty detection
- `tests/claude/fasten.test.ts` — new test file
- `tests/fixtures/fasten-with-findings.md` — test fixture
- `tests/fixtures/fasten-empty.md` — test fixture

### Tasks

1. **Create `src/claude/fasten.ts`** with the following interface:

   ```typescript
   export interface FastenAnalysisResult {
     output: string;
     isEmpty: boolean;
   }

   export async function runFastenAnalysis(cwd: string): Promise<FastenAnalysisResult>
   ```

   Implementation:
   - Build the prompt as a template literal combining:
     - The analysis instructions from the objective (6 categories of dead code, per-finding requirements)
     - The output template from the product spec (3-bucket markdown tables with Summary, Safe to Delete, Needs Review, Keep but Flag sections)
     - Include the `# Complete` checkbox section: `- [ ] Ready to advance to Plan Questions`
   - Load context: read `README.md` and `CLAUDE.md` from `cwd` if they exist (`existsSync` check, `readFileSync`). Prepend to prompt as project context.
   - Call `runAndStream()` with:
     - `prompt`: the assembled prompt
     - `persona`: `""` (empty — no role persona for utility analysis)
     - `cwd`: passed through
     - `allowedTools`: `["Read", "Glob", "Grep"]`
     - `stage`: `"ai_objective_review"` (triggers review-stage guard restrictions)
     - `taskPlanPath`: `""` (no plan folder yet — blocks all writes)
   - After session completes, check for empty findings using `isEmpty` detection
   - Return `{ output: result, isEmpty }`

2. **Implement isEmpty detection** as a private function:

   ```typescript
   function isEmptyAnalysis(output: string): boolean
   ```

   Heuristic:
   - Check if all three table sections (Safe to Delete, Needs Review, Keep but Flag) have no data rows. A data row starts with `|` and contains content beyond just header separators (`|---|`).
   - Also check for explicit "no dead code found" phrase (case-insensitive).
   - Return `true` if no data rows found in any table OR the explicit phrase is present.

3. **Create test fixtures**:
   - `tests/fixtures/fasten-with-findings.md` — valid analysis output with entries in all three tables, following the exact product spec format
   - `tests/fixtures/fasten-empty.md` — valid analysis output with empty tables (header rows only, no data rows)

4. **Verify**: `npm run typecheck` passes.

### Test requirements

- **`tests/claude/fasten.test.ts`** (new file):
  - Mock `runAndStream` via `vi.mock("../../src/claude/session.js")` (same pattern as `tests/pipeline/handlers/objective-review.test.ts`)
  - Mock `fs` reads for README.md/CLAUDE.md
  - Test: prompt includes all 6 dead code categories
  - Test: prompt includes the output template (3-bucket table format)
  - Test: prompt includes completion checkbox
  - Test: calls `runAndStream` with `allowedTools: ["Read", "Glob", "Grep"]`
  - Test: calls `runAndStream` with `stage: "ai_objective_review"` and `taskPlanPath: ""`
  - Test: calls `runAndStream` with empty persona
  - Test: returns `{ output, isEmpty: false }` when fixture has findings
  - Test: returns `{ output, isEmpty: true }` when fixture has empty tables
  - Test: returns `isEmpty: true` when output contains "no dead code found"
  - Test: throws when `runAndStream` returns empty string (session failure)
  - Test: includes README.md content in prompt when file exists
  - Test: works without README.md/CLAUDE.md (graceful degradation)

---

## Milestone 3: CLI Command + Integration

### Goal

Build `src/cli/fasten.ts`, register it in `src/cli/index.ts`, and validate the full end-to-end flow including duplicate detection, zero-findings early exit, and the trivial fast-path.

### Existing code reused

- `src/cli/index.ts` — `wrapAction()` for error handling, `createProgram()` for registration
- `src/config/loader.ts` — `loadConfig()` for config access
- `src/state/discovery.ts` — `discoverTasks()` for duplicate detection
- `src/utils/logger.ts` — `log` for all terminal output

### Existing code extended

- `src/cli/index.ts` — add `fasten` command registration (new import + 4 lines of commander config)

### Genuinely new

- `src/cli/fasten.ts` — new file with command orchestration
- `tests/cli/fasten.test.ts` — new test file

### Dependencies from previous milestones

- M1: `createPlanFolder()` from `src/state/plan-folder.ts`
- M2: `runFastenAnalysis()` from `src/claude/fasten.ts`

### Tasks

1. **Create `src/cli/fasten.ts`**:

   ```typescript
   import { loadConfig } from "../config/loader.js";
   import { discoverTasks } from "../state/discovery.js";
   import { createPlanFolder } from "../state/plan-folder.js";
   import { runFastenAnalysis } from "../claude/fasten.js";
   import { log } from "../utils/logger.js";
   import path from "path";

   export async function fastenCommand(opts: { force?: boolean }): Promise<void>
   ```

   Implementation:
   - `const cwd = process.cwd()`
   - `const config = loadConfig(cwd)`
   - `const plansDir = path.join(cwd, config.plans_dir)`
   - **Duplicate detection**: call `discoverTasks(plansDir)`, filter for `t.slug.startsWith("fasten-") && t.stage !== "done" && t.stage !== "error"`. If match found and `!opts.force`:
     - `log.warn(\`An active fasten plan already exists (task #${match.number}).\`)`
     - `log.info(\`Run \`vibe-racer drive\` to complete it, or use \`vibe-racer fasten --force\` to create a new one.\`)`
     - `process.exit(1)`
   - **Run analysis**: `const result = await runFastenAnalysis(cwd)`
   - **Zero-findings exit**: if `result.isEmpty`:
     - `log.info("No dead code found — nothing to fasten.")`
     - `return` (exit 0)
   - **Create plan**:
     ```typescript
     const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
     const slug = `fasten-${today}`;
     const { taskNumber, folderName } = createPlanFolder({
       title: `fasten-${today}`,
       plansDir,
       slug,
       trivial: true,
       objectiveContent: result.output,
       checkboxLabel: "Plan Questions",
       checked: false,
     });
     ```
   - **Print summary**:
     - `log.success(\`Task #${taskNumber} created: ${path.join(config.plans_dir, folderName)}\`)`
     - `log.info("Review the analysis in 00_objective.md")`
     - `log.info("Tick the checkbox, then run: vibe-racer drive")`

2. **Register in `src/cli/index.ts`**:

   Add import: `import { fastenCommand } from "./fasten.js";`

   Add command registration after the `radio` command:

   ```typescript
   program
     .command("fasten")
     .description("Run dead code analysis and create a cleanup plan")
     .option("--force", "Create a new fasten plan even if an active one exists")
     .action(wrapAction(fastenCommand));
   ```

3. **Verify**: `npm run typecheck`, `npm run test`, `npm run lint`.

### Test requirements

- **`tests/cli/fasten.test.ts`** (new file):
  - Mock: `runFastenAnalysis`, `createPlanFolder`, `discoverTasks`, `loadConfig`, `log`, `process.exit`
  - Test: happy path — calls `runFastenAnalysis`, calls `createPlanFolder` with `trivial: true`, prints success
  - Test: `createPlanFolder` receives `slug: "fasten-YYYY-MM-DD"` (today's date)
  - Test: `createPlanFolder` receives `checkboxLabel: "Plan Questions"` and `checked: false`
  - Test: zero findings — `runFastenAnalysis` returns `isEmpty: true`, no `createPlanFolder` call, prints clean message
  - Test: duplicate detection — `discoverTasks` returns active fasten plan, exits with code 1
  - Test: duplicate detection with `--force` — skips check, proceeds normally
  - Test: duplicate detection ignores `done` and `error` stage fasten plans
  - Test: `runFastenAnalysis` error propagates (caught by `wrapAction`)

- **Update `tests/cli/cli.test.ts`**:
  - Add assertion: `--help` output includes `fasten`

- **Integration test `tests/cli/fasten-integration.test.ts`** (new file):
  - Uses temp directory as project root
  - Mocks `runAndStream` only (everything else is real)
  - Test: full happy path — `fastenCommand()` creates plan folder with `state.yml` containing `trivial: true` and stage `need_objective`, and `00_objective.md` with analysis content and unchecked checkbox
  - Test: verifies `state.yml` has `trivial: true` by reading the file directly

---

## Dependency Graph

```
M1 (Extract createPlanFolder)  ──┐
                                  ├──► M3 (CLI command + integration)
M2 (Analysis runner)  ───────────┘
```

M1 and M2 are independent. M3 depends on both.

---

## Test Strategy

### Layers

| Layer | What's tested | Mock boundary |
|---|---|---|
| Unit: `plan-folder.ts` | Folder creation, state.yml writing, trivial flag, checkbox | File system (real, via temp dirs) |
| Unit: `claude/fasten.ts` | Prompt construction, isEmpty detection, session params | `runAndStream` (mocked) |
| Unit: `cli/fasten.ts` | Orchestration, duplicate detection, zero-findings exit | `runFastenAnalysis`, `createPlanFolder`, `discoverTasks` (all mocked) |
| Integration | End-to-end: fasten creates correct plan, state.yml has trivial flag | `runAndStream` only (mocked) |
| Existing regression | `new` command still works, CLI help includes `fasten` | Per existing test setup |

### Conventions (matching existing codebase)

- Test files in `tests/` directory mirroring `src/` structure
- `vi.mock()` at module level for external dependencies
- `mkdtempSync` / `rmSync` for temp directory isolation
- `vi.clearAllMocks()` in `beforeEach`
- Dynamic imports (`await import(...)`) when module has top-level mocked deps
- Mock logger as `{ info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn(), guard: vi.fn() }`

### Run commands

- `npm run test` — all tests pass after each milestone
- `npm run typecheck` — no type errors after each milestone
- `npm run lint` — no lint errors after each milestone
