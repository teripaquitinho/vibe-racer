# Design Specification — #5: infinite-loop-fix

> **Role**: Senior Software Architect
> **Stage**: `ai_design_review` → `need_plan`
> **Date**: 2026-09-21
> **Inputs**: `00_objective.md`, `01_product.md`, `02_design_questions.md` (Q1–Q6),
> `execute_infinite_loop_bug.md` (root-cause spec, deleted when this work lands)

Every decision below cites the answer it comes from — **Q1**–**Q6** are the design answers,
**§n.n** are product-spec sections, **AC n** are the product spec's acceptance criteria.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Directory structure](#2-directory-structure)
3. [Module: `src/pipeline/execute-table.ts`](#3-module-srcpipelineexecute-tablets)
4. [Module: `src/pipeline/operator-block.ts`](#4-module-srcpipelineoperator-blockts)
5. [State layer](#5-state-layer)
6. [Module: `src/pipeline/handlers/execute.ts`](#6-module-srcpipelinehandlersexecutets)
7. [Module: `src/state/advancement.ts`](#7-module-srcstateadvancementts)
8. [Prompt layer](#8-prompt-layer)
9. [CLI layer](#9-cli-layer)
10. [Integration patterns](#10-integration-patterns)
11. [Data flows](#11-data-flows)
12. [Configuration and environment](#12-configuration-and-environment)
13. [Testing strategy](#13-testing-strategy)
14. [Build and distribution](#14-build-and-distribution)
15. [Dependency summary](#15-dependency-summary)
16. [Traceability matrix](#16-traceability-matrix)
17. [Risks and deferred decisions](#17-risks-and-deferred-decisions)

---

## 1. Architecture Overview

### 1.1 The shape of the fix

Today `handleExecute` is a single `while (true)` that interleaves parsing, session execution,
git commits and state writes, with one exit condition: a regex count reaching zero. The fix is
not "add a counter". It is **four seams**, each testable on its own:

```
          ┌──────────────────────────────────────────────────────────────┐
          │  CONTRACT          src/pipeline/execute-table.ts             │
          │  The Execution Status table: statuses, owners, the spec      │
          │  block prompts quote, the parser, the single-cell mutator.   │
          │  Pure. String in, structure out. Zero I/O.            (Q1,Q2)│
          └───────────────┬──────────────────────────────┬───────────────┘
                          │ imports                      │ imports
          ┌───────────────▼──────────────┐   ┌───────────▼──────────────┐
          │  FORMAT                      │   │  DECISION                │
          │  operator-block.ts           │   │  decideNextStep()        │
          │  Pause-block render / find / │   │  inside execute.ts       │
          │  read / normalise. Makes the │   │  Pure function of        │
          │  agent's prose inert.  (Q3)  │   │  LoopState → Step  (Q5)  │
          └───────────────┬──────────────┘   └───────────┬──────────────┘
                          │                              │
          ┌───────────────▼──────────────────────────────▼──────────────┐
          │  EFFECTS                                                    │
          │  handleExecute driver  ·  advancement.resumeFromOperatorPause│
          │  SDK sessions, git, state.yml, terminal.        (Q5, Q6)    │
          └─────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────▼──────────────────────────────────────────────┐
          │  STATE          schema.ts · store.ts · states.ts             │
          │  need_operator as a non-linear stage, pause/resume helpers,  │
          │  the (file, markerText) map.                          (Q4)   │
          └──────────────────────────────────────────────────────────────┘
```

The load-bearing property: **the two layers that decide anything are pure.** A test for the
reported bug (AC1) is a table-driven assertion over `decideNextStep`, with no SDK, no git and no
filesystem in sight (Q5).

### 1.2 The stage machine after this task

```
     need_execution ──tick "Ready to advance to Execution"──> ready_to_execute
                                                                    │
                                              ┌─────────────────────┤
                                              │                     │
                                     no unfinished rows        pause (4 causes)
                                              │                     │
                                              ▼                     ▼
                                           ai_qa            need_operator  ◄── outside
                                                                    │          STAGE_ORDER
                                        tick "Operator actions      │
                                        complete — resume execution"│
                                              ┌─────────────────────┘
                                              ▼
                                       ready_to_execute   (same `drive` invocation, §6.6)
```

`need_operator` joins `error` in a named `NON_LINEAR_STAGES` set (Q4). It is the only stage
whose `prev`/`next` come from a stored field (`paused_stage`) rather than from list position.

### 1.3 Design invariants this task introduces

| # | Invariant | Enforced by |
|---|---|---|
| I1 | The table contract is described in **one** place; prompts quote it | Contract test over `EXECUTION_TABLE_SPEC` (Q1) |
| I2 | An unreadable table **throws**; it never reads as "nothing pending" | `ExecutionTableError` (Q2, AC12) |
| I3 | `(file, markerText)` is injective across stages | `states.test.ts` invariant test (Q4, AC20) |
| I4 | Agent prose in `04_execute.md` is **structurally** inert | Blockquote prefix + fence-aware scanner (Q3) |
| I5 | Termination is bounded even if the parser is wrong | Session cap computed once at loop entry (Q5, §4.5) |
| I6 | `state.yml` stays pipeline-owned | Guard Rule 0, unchanged (§11) |

---

## 2. Directory structure

Two new source modules, two new test files, no new directories.

```
src/
  pipeline/
    execute-table.ts        ★ NEW — table contract, parser, mutator            (Q1, Q2)
    operator-block.ts       ★ NEW — pause-block format: render/find/read/normalise (Q3)
    states.ts               ~ NON_LINEAR_STAGES; STAGE_QUESTIONS_FILE → {file, markerText}
    validation.ts           · unchanged — stays stage-agnostic                  (Q1)
    types.ts                · unchanged
    handlers/
      execute.ts            ~ REWRITTEN — decideNextStep + effectful driver     (Q5)
      qa.ts                 ~ passes the gate list into qaPrompt               (§11, AC19)
  state/
    schema.ts               ~ need_operator + paused_stage/operator_*/resumed_at (Q4)
    store.ts                ~ writeState branch; pauseForOperator/resumeFromOperator (Q4)
    advancement.ts          ~ resumeFromOperatorPause; gate list at need_execution (Q6, AC14)
    discovery.ts            ~ Task carries operatorReason/operatorMilestone      (Q6)
  claude/
    prompts.ts              ~ plan/execute/qa/chat prompts                      (Q1, §4.7, §7.5)
    guard.ts                · UNCHANGED — constraint, not oversight             (§11)
  git/
    operations.ts           ~ repoSnapshot(), currentBranch()                   (Q5, §5.4, E17)
  cli/
    drive.ts                ~ "waiting on operator" branch + marker text + branch hint (Q6)
    pitwall.ts              ~ "Waiting on operator" group above pit stops       (§7.1)

tests/
  pipeline/execute-table.test.ts     ★ NEW
  pipeline/operator-block.test.ts    ★ NEW
  pipeline/handlers/execute.test.ts  ~ rewritten around decideNextStep
  state/advancement.test.ts          ~ resume cases
  pipeline/states.test.ts            ~ (file, markerText) injectivity
  fixtures/playbooks/                ★ NEW — copies of real 0002–0004 tables + edge cases
```

**Why two new modules rather than growing `validation.ts` (Q1).** The bug spec proposed putting
the parser in `validation.ts`. That file's job is generic answer/marker/checklist validation
across *all* stages; giving it table knowledge couples every stage to the execute lap and makes
the new surface hard to test in isolation. `validation.ts` keeps its current exports and its
current tests untouched.

---

## 3. Module: `src/pipeline/execute-table.ts`

> Source: **Q1** (the contract), **Q2** (the parser). Pure — no `fs`, no `git`, no logging.

### 3.1 Exported contract

```ts
export const MILESTONE_STATUSES = ["pending", "in_progress", "done", "needs_operator"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const OWNERS = ["agent", "operator"] as const;
export type Owner = (typeof OWNERS)[number];

/** Describes gates in the prompt and labels them in logs. NEVER used to classify a row. */
export const GATE_ID_PATTERN = /^G\d+$/;

export const EXECUTION_STATUS_HEADING = "Execution Status";

/** The human-readable block both planReviewPrompt and executeMilestonePrompt interpolate. */
export const EXECUTION_TABLE_SPEC: string;
```

`blocked` is **not** in the union (Q1.3). It survives only as a parser-internal alias (§3.4).

**A row is a gate because `owner === "operator"`, never because of how its ID is spelled** (Q1).
IDs are never validated: shipped playbooks already contain `M5a`/`M5b` (`plans/0004`), and the
operator may renumber by hand (§6.5). `GATE_ID_PATTERN` exists for prompt text and log labels.

### 3.2 Data model

```ts
export interface MilestoneRow {
  id: string;                 // "M9" | "G1" | "M5a" | whatever the operator wrote
  name: string;
  owner: Owner;               // defaults to "agent" when there is no Owner column
  status: MilestoneStatus;
  commit?: string;
  notes?: string;
  lineIndex: number;          // absolute line in the file — setMilestoneStatus writes here
  legacyBlocked: boolean;     // this row literally said `blocked`
}

export interface ColumnMap {
  milestone: number;          // required
  status: number;             // required
  name?: number;
  owner?: number;             // absent ⇒ every row is agent-owned  (§9.3)
  commit?: number;
  notes?: number;
}

export interface ExecutionTable {
  rows: MilestoneRow[];
  headerLineIndex: number;
  columns: ColumnMap;
}
```

### 3.3 `parseExecutionStatus(content: string): ExecutionTable`

**Locating the table.** Scan for the first markdown heading (`#`–`######`) whose text contains
`EXECUTION_STATUS_HEADING`, case-insensitively. Take the first pipe table after it; the table
ends at the first blank line or the next heading. **Nothing outside that table is ever read** —
this alone fixes E3 (a `pending` in the Milestone Summary table or in prose keeping the loop
alive, bug spec §2.4.3).

**Column resolution is by header name, not position** (Q2). Each header cell is normalised with
`trim → lowercase → strip backticks → strip bold markers`, then matched against
`milestone|name|owner|status|commit|notes`. A missing `Owner` column leaves `columns.owner`
undefined and every row defaults to `agent`. Extra columns are ignored, not an error.

**Cell splitting.** A naive `line.split("|")` breaks on the real playbooks: `plans/0004`'s Notes
cells hold paragraphs with inline code and prose. `splitRow` therefore honours `\|` escapes and
backtick spans, and only `Milestone`, `Owner` and `Status` need to resolve cleanly (Q2).

**Tolerated** (Q2): any case; surrounding backticks; bold (`**done**`); leading/trailing
whitespace; extra columns; an absent alignment row; `—` or empty cells; pipes inside cells.

**Throws `ExecutionTableError` when** (Q2, AC12):

| Condition | Message names |
|---|---|
| No "Execution Status" heading | the file, and that the heading is required |
| No pipe table under the heading | the file, the heading's line |
| No `Milestone` **or** no `Status` column | the file, the header line, the headers it did find |
| Zero data rows | the file, the header line |
| Any row status not in the union after normalisation | the file, the offending line number **and** the offending value, and the legal values |

```ts
export class ExecutionTableError extends Error {
  constructor(message: string, readonly file?: string, readonly line?: number);
}
```

`withErrorHandling` turns this into `stage: error` with the message preserved (§10.3). AC12 is a
**message-quality** criterion, not just a control-flow one — the assertions check the message
text, not only that it threw.

### 3.4 Legacy `blocked`

```ts
const LEGACY_STATUS_ALIASES: Record<string, MilestoneStatus> = { blocked: "needs_operator" };
```

A `blocked` row parses to `status: "needs_operator", legacyBlocked: true` (Q2). The handler reads
`legacyBlocked` to add the *"marked `blocked` by an earlier run"* line to the pause block (§9.3),
so the status union never grows a fifth member. This is AC11: `blocked` pauses instead of being
silently skipped.

### 3.5 Mutation and derived queries

```ts
/** Rewrites ONLY the status cell on that row's line, byte-preserving the rest. */
export function setMilestoneStatus(content: string, id: string, status: MilestoneStatus): string;

export function firstUnfinished(table: ExecutionTable): MilestoneRow | null;   // status !== "done"
export function operatorGates(table: ExecutionTable): MilestoneRow[];          // owner === "operator"
export function pendingAgentRows(table: ExecutionTable): MilestoneRow[];
export function doneCount(table: ExecutionTable): number;
export function hasOwnerColumn(table: ExecutionTable): boolean;                // for the §9.3 line
```

`setMilestoneStatus` on an **absent row is a no-op, not an error** (Q2). The operator may have
deleted or renumbered the row while paused; hand edits must never break resume (§6.5, AC9).
Byte-preservation matters because the operator's own column alignment and Notes prose live on
that same line.

### 3.6 The drift guard

`EXECUTION_TABLE_SPEC` is a template literal built **from** `MILESTONE_STATUSES` and `OWNERS`,
not a hand-written copy of them. It contains the header row, the meaning of each column, the
legal status values, the gate-row rule, and a worked example. Both prompts interpolate it
verbatim (Q1.1), so adding a status to the union changes the prompts automatically.

The contract test (§13.2) asserts that every member of both unions appears in the rendered plan
prompt and execute prompt, and that the example table inside `EXECUTION_TABLE_SPEC` round-trips
through `parseExecutionStatus`. Today's bug is partly a drift bug — `blocked` existed in the plan
prompt and meant nothing to the handler — and this is the cheapest possible guard against that
exact class (Q1.2).

---

## 4. Module: `src/pipeline/operator-block.ts`

> Source: **Q3**. Owns the pause-block format end to end. **Nothing else in the codebase knows
> the block's shape.** Pure — the handler owns file I/O.

### 4.1 Exported constants

```ts
export const OPERATOR_RESUME_MARKER = "Operator actions complete — resume execution";
export const PAUSE_HEADING_PATTERN = /^## Operator actions — pause (\d+) \(([^)]+)\)/;

/** The block format, quoted verbatim by executeMilestonePrompt so an agent-written block
 *  matches what normalisePauseBlock expects. */
export const PAUSE_BLOCK_SPEC: string;
```

The marker is deliberately **not** `Ready to advance …`: `04_execute.md` already carries the
ticked "Ready to advance to Execution" from sign-off, and sharing the marker would resume the
task instantly — the stale-tick failure issue #3 fixed (§5.6, AC8).

### 4.2 Types

```ts
export type PauseCause =
  | "planned_gate" | "agent_declared" | "stall" | "session_cap" | "legacy_blocked";

export type StallKind = "no_changes" | "committed_unfinished";   // §5.4

export interface PauseBlockInput {
  pauseNumber: number;
  rowId: string;
  cause: PauseCause;
  why: string;                       // one sentence — also becomes operator_reason  (§7.3)
  items: string[];                   // ≥ 1 enforced by the renderer                 (§5.2)
  verification: string | null;       // null ⇒ "None — the agent will simply retry"
  agentMessage: string | null;       // null ⇒ "The agent left no closing message…"  (E5)
  branchName: string;                // closing line names the branch                (E17)
  stallKind?: StallKind;             // stall cause only                             (§5.4)
  isRepause?: boolean;               // "G1 again" wording                           (§6.2)
  extraNotes?: string[];             // legacy-playbook / legacy-blocked lines       (§9.3)
}

export interface PauseBlockLocation { number: number; rowId: string; startLine: number; endLine: number }
export interface PauseBlockState { markerTicked: boolean; unchecked: Array<{ line: number; text: string }> }
```

### 4.3 Exported functions

```ts
export function renderPauseBlock(input: PauseBlockInput): string;
export function findLastPauseBlock(content: string): PauseBlockLocation | null;
export function readPauseBlockState(content: string): PauseBlockState | null;   // last block only
export function untickResumeMarker(content: string): string;
export function normalisePauseBlock(content: string, ctx: { pauseNumber: number; rowId: string;
                                                            branchName: string }): string;
export function nextPauseNumber(content: string): number;                       // last + 1, else 1
export function extractGateSection(planMarkdown: string, gateId: string):
  { items: string[]; verification: string | null } | null;
```

`renderPauseBlock` is **the single renderer for all five causes**, which is what makes the
guaranteed-minimum five elements of §5.2 structurally impossible to omit: the renderer fills
every default itself ("None — the agent will simply retry", "The agent left no closing message;
see the terminal log or the last commits", the generic item, the closing line).

`readPauseBlockState` is scoped to the **last** block only — that is what makes AC8 true by
construction rather than by a regex that happens to match the right thing (Q3).

`extractGateSection` lives here, not in `execute-table.ts`, because its only consumer is
pause-block construction and its return type is a slice of `PauseBlockInput`. It locates a
heading in `03_plan.md` whose text begins with the gate ID (`## G1 — …`, `### G1: …`), collects
the `- [ ]` items under it and the `**Verification:**` line. Returns `null` when the plan has no
such section; the handler then falls back to the generic item (§5.3).

### 4.4 Inertness is structural, not regex-based

A session that emits `- [x] Operator actions complete — resume execution` in its final message
must not be able to resume its own task (§5.5, E6). Two layers (Q3):

**Layer 1 — fence + blockquote.** The agent's message is rendered inside a `~~~` fence *and*
every line is prefixed as a blockquote:

```markdown
**What the agent said:**

~~~
> I didn't start M9 because PRs 0,1,2,9,3 are not merged.
> - [ ] this is the agent's text, not a real item
~~~
```

The fence character is `~`, chosen longer than the longest `~` run in the message, so a message
containing ``` cannot break out. The fence is for *rendering*; **the blockquote prefix is what
makes the text inert**, because a `- [ ]` behind `> ` is never at a position the scanner accepts.

**Layer 2 — a fence-aware scanner.** `readPauseBlockState` walks only the last block's lines,
tracks fence state (``` and ~~~, matching run length), and skips any line inside a fence and any
line starting with `>`. It recognises the resume marker only when it is an unindented
`- [ ]`/`- [x]` whose text equals `OPERATOR_RESUME_MARKER`.

**`validateDecisionChecklist` is deliberately not reused here** (Q3). It matches *indented*
items on purpose — at `need_decision` an indented unworked item must still block. Pause blocks
have the opposite requirement. Two functions with opposite indentation rules must not be one
function; `validation.ts` is untouched.

### 4.5 Agent-authored blocks are normalised, never trusted

The execute session has `Edit` on `04_execute.md` and §5.3 lets it write its own block. Quoting
covers the agent's *message*; it does not cover a block the agent *authored* — which could
arrive with every box and the resume marker already ticked, a wrong pause number, or no marker
at all. So `normalisePauseBlock` runs on **every** pause regardless of who wrote the block (Q3):

1. untick every checkbox in the last block (including the resume marker);
2. correct the heading's pause number and row ID;
3. ensure the closing line names the task branch (E17);
4. if the §5.2 minimum is not met — no marker, no actionable item, no closing line — **lift the
   agent's items and re-render through `renderPauseBlock`**.

"Structurally impossible to omit" is only true once every block has been through the renderer or
the normaliser.

### 4.6 The rendered block

```markdown
## Operator actions — pause 1 (G1)

**Why paused:** M9 builds on the layout API, token names and logo components from
PRs 0,1,2,9,3, which are not merged into `main` (origin/main still at 273c1c9).

- [ ] Open PRs against `main` in order 0 → 1 → 2 → 9 → 3
- [ ] Clear human gates: screenshot checks, PR 3 dev soak
- [ ] Merge all five PRs

**Agent will verify on resume:** `git merge-base --is-ancestor <each branch> origin/main`

- [ ] Operator actions complete — resume execution

When done, switch back to branch `vibe-racer/0005_infinite-loop-fix`, tick every box above and
run `vibe-racer drive`.
```

Blocks are **appended** to the end of `04_execute.md` — after the sign-off `# Complete` section,
which is harmless because `findLastPauseBlock` locates blocks by heading, and the `need_operator`
stage never routes through `hasCompletionMarker` (§5.4). History is kept; only the last block
counts (§5.1).

---

## 5. State layer

> Source: **Q4**.

### 5.1 `src/state/schema.ts`

```ts
export const STAGES = [
  …, "need_execution", "ready_to_execute", "need_operator", "ai_qa", …, "error",
] as const;

export const stateSchema = z.object({
  …,
  paused_stage: z.enum(STAGES).optional(),      // where to return to — always ready_to_execute in v1
  operator_reason: z.string().optional(),       // the one-line reason  (§7.3)
  operator_milestone: z.string().optional(),    // the paused row's ID
  resumed_at: z.string().optional(),            // row ID just resumed — drives threshold 1  (Q5)
});
```

`need_operator` is placed adjacent to `ready_to_execute` for readability; **the position is inert**
because the stage is excluded from `STAGE_ORDER`.

The pause fields are *not* folded into `error_stage`/`error_message` (Q4): `pitwall` and `drive`
must tell a pause from a failure without string-inspecting a stage name, and a task can
legitimately error *while* it carries pause fields.

`resumed_at` is persisted rather than threaded through `TaskContext` (Q5.1). `drive` dispatches
**one** task per invocation, chosen *after* the advancement pass; with two actionable tasks the
resumed one may not run until a later `drive`, and an in-memory value would be gone — silently
restoring threshold 2 and charging the operator for a second identical session. It also honours
the project rule that state lives in `state.yml`, never in memory.

### 5.2 `src/pipeline/states.ts`

```ts
const NON_LINEAR_STAGES = new Set<Stage>(["error", "need_operator"]);
const STAGE_ORDER: Stage[] = STAGES.filter((s) => !NON_LINEAR_STAGES.has(s));
```

Replacing the current `STAGES.filter(s => s !== "error")` with a named set makes the next detour
stage a one-line change and names the intent (Q4). `isHumanStage` then returns `true` for
`need_operator` for free — which is exactly what makes `radio` work at a pause with no new
plumbing (§7.5) and what puts the task in `drive`'s advancement pass.

```ts
export interface StageQuestions { file: string; markerText: string }

export const STAGE_QUESTIONS_FILE: Partial<Record<Stage, StageQuestions>> = {
  need_objective: { file: "00_objective.md",          markerText: "Ready to advance to Objective Review" },
  need_product:   { file: "01_product_questions.md",  markerText: "Ready to advance to Product Review" },
  need_design:    { file: "02_design_questions.md",   markerText: "Ready to advance to Design Review" },
  need_plan:      { file: "03_plan_questions.md",     markerText: "Ready to advance to Plan Review" },
  need_execution: { file: "04_execute.md",            markerText: "Ready to advance to Execution" },
  need_operator:  { file: "04_execute.md",            markerText: OPERATOR_RESUME_MARKER },
  fine_tuning:    { file: "05_qa.md",                 markerText: "Ready to advance to Cleanup" },
  need_decision:  { file: "06_decision.md",           markerText: "Ready to advance to Done" },
};
```

**One map, not two parallel ones**, because two maps can disagree (Q4). `markerText` is what
`drive` prints in its hint (§7.2) and what the invariant test pairs with `file`.

`STAGE_NEXT_NAME` does **not** get a `need_operator` entry. Every consumer of that map builds the
string `"Ready to advance to ${name}"` — which is exactly the wording §7.2 forbids for a pause.

`hasCompletionMarker` / `removeCompletionMarker` keep their signatures and their hard-coded
`Ready to advance` regex, and are **never called for `need_operator`** (Q6 routes that stage
elsewhere). Parameterising them would touch every handler call site for no behavioural gain, in
the one file where a slip re-opens issue #3.

**Blast radius of the map change** (verified by grep): `advancement.ts:24`, `drive.ts:100-101`,
`states.test.ts:95-103`. Three call sites switch from `STAGE_QUESTIONS_FILE[s]` to `…?.file`.

### 5.3 `src/state/store.ts`

`writeState` grows a `need_operator` branch mirroring the `error` one:

```ts
if (state.stage === "error") {
  prev = validStage(state.error_stage) ?? null;  next = null;
} else if (state.stage === "need_operator") {
  const paused = validStage(state.paused_stage) ?? "ready_to_execute";
  prev = paused;  next = paused;                 // the detour returns whence it came
} else {
  prev = previousStage(state.stage);  next = nextStage(state.stage);
}
```

Without this branch `nextStage("need_operator")` returns `null` (index `-1`), and a paused task
would render with no forward arrow in `pitwall`.

Three helpers so "which fields get cleared on resume" lives in exactly one place (Q4):

```ts
export function pauseForOperator(
  planPath: string,
  args: { milestone: string; reason: string; pausedStage?: Stage },
): void;

export function resumeFromOperator(planPath: string): { pausedStage: Stage; milestone?: string };

export function clearResumedAt(planPath: string): void;          // §6.3 — one write, then never again
```

`pauseForOperator` writes `stage: need_operator`, `paused_stage` (default `ready_to_execute`),
`operator_reason`, `operator_milestone`, and clears `resumed_at`.
`resumeFromOperator` sets `stage` back to `paused_stage`, **returns** `operator_milestone` before
clearing it, writes `resumed_at: <milestone>`, and clears `paused_stage`/`operator_*`. A
forgotten `operator_reason` would otherwise haunt `pitwall` for the rest of the task's life.

**`planPath` here is absolute — and that is not what every caller already holds.** The two
existing conventions in this codebase disagree, silently: handlers pass repo-relative
`ctx.planPath` straight into `updateStage` (`execute.ts:47`), which works only because the
process cwd is the repo root, while `advancement.ts:61` passes `path.join(cwd, planPath)`. All
three helpers above take the **absolute** form, so the call in §6.4 is
`pauseForOperator(path.join(ctx.cwd, ctx.planPath), …)` and the one in §7.2 is
`resumeFromOperator(path.join(cwd, planPath))`. Getting it wrong is neither quiet nor contained:
`readState` throws `ENOENT`, and `tryAdvance` runs inside the `for (const task of tasks)` loop at
`drive.ts:59-74`, which is **not** wrapped in `withErrorHandling` — one bad path takes down
`drive` for every task, before any task is selected.

### 5.4 `src/state/discovery.ts`

`Task` carries the two pause fields so the CLI layer never parses files (Q6):

```ts
export interface Task {
  …
  operatorReason?: string;
  operatorMilestone?: string;
}
```

This is exactly how `trivial` is already carried, and it is the reason §8.4 writes the reason
into `state.yml` in the first place.

### 5.5 `state.yml` while paused

```yaml
stage: need_operator
title: infinite-loop-fix
paused_stage: ready_to_execute
operator_reason: "M9 requires PRs 0,1,2,9,3 merged into main"
operator_milestone: M9
prev: ready_to_execute
next: ready_to_execute
```

---

## 6. Module: `src/pipeline/handlers/execute.ts`

> Source: **Q5**. Split into a pure decision function and a thin effectful driver.

### 6.1 The pure core

```ts
export const MAX_STALLED_SESSIONS = 2;        // §4.4 — not configurable in v1 (§9.1)
export const SESSION_CAP_SLACK = 2;

export interface LoopState {
  table: ExecutionTable;
  currentId: string | null;
  stalls: number;
  sessionsThisDrive: number;
  sessionCap: number;
  resumedAt: string | null;          // from state.resumed_at, read once at loop entry
  lastOutcome: SessionOutcome | null;
}

export interface SessionOutcome {
  rowId: string;
  statusAfter: MilestoneStatus | null;   // null ⇒ the row vanished mid-session
  doneCountBefore: number;
  doneCountAfter: number;
  repoChanged: boolean;                  // new commits or new dirty files OUTSIDE the plan dir
  finalMessage: string | null;
}

export type Step =
  | { kind: "run"; row: MilestoneRow }
  | { kind: "pause"; row: MilestoneRow; cause: PauseCause }
  | { kind: "complete" };

export function decideNextStep(state: LoopState): Step;
export function foldOutcome(state: LoopState, outcome: SessionOutcome): LoopState;
export function thresholdFor(rowId: string, resumedAt: string | null): number;
export function sessionCap(table: ExecutionTable): number;
```

`decideNextStep` implements §8.3 exactly:

```
next = firstUnfinished(table)
if (!next)                            → complete
if (next.status === "needs_operator") → pause(next, next.legacyBlocked ? "legacy_blocked"
                                                                      : "agent_declared")
if (next.owner === "operator")        → pause(next, "planned_gate")     // zero sessions
if (sessionsThisDrive >= sessionCap)  → pause(next, "session_cap")
if (currentId === next.id && stalls >= thresholdFor(next.id, resumedAt))
                                      → pause(next, "stall")
                                      → run(next)
```

`foldOutcome` is the other half and is where AC4 lives:

```
if (statusAfter === "done")            → stalls = 0
else if (statusAfter === "needs_operator") → stalls = 0   (decide() will pause on the next tick)
else if (statusAfter === null)         → progress iff doneCountAfter > doneCountBefore
else                                   → stalls++
currentId = rowId; sessionsThisDrive++
```

Every acceptance criterion from AC1 to AC6 is a table-driven unit test over these two functions
with **zero mocks**.

### 6.2 Three details fixed in the design, not discovered in code (Q5)

**1. The stall threshold is a function of state, not a constant.**
`thresholdFor(rowId, resumedAt)` returns `1` when `rowId === resumedAt` (the post-overrule rule,
§4.4) and `MAX_STALLED_SESSIONS` otherwise. `resumedAt` comes from `state.resumed_at`, read once
at loop entry; the driver clears it when that row reaches `done`.

**2. A row that vanishes mid-session is judged by position, not ID.** If the agent renamed or
split the row, `statusAfter` is `null`; the outcome counts as progress when `doneCount` grew and
a stall otherwise. **Never an exception** — E12 says a renumbered row must not break anything.

*Note the asymmetry this leaves, so it is not rediscovered as a bug.* When the row is still there
but untouched — the agent went and finished a **later** milestone instead — `statusAfter` is
`"pending"`, not `null`, so the `doneCount` branch never runs and the session counts as a stall.
Two of those pause at the first unfinished row saying *"no progress in 2 sessions"* while the
repository visibly moved. That is the intended reading (the row we asked for did not move), and
out-of-order execution is deferred by product decision (§17) — and the wording stays honest
because `repoChanged` is true in that case, so the block says *"committed but did not finish"*
rather than *"made no changes"* (§5.4).

**3. The session cap is computed once, at loop entry**, from the initial parse:
`sessionCap(table) = pendingAgentRows(table).length * MAX_STALLED_SESSIONS + SESSION_CAP_SLACK`.
Computing it per iteration would let a growing table raise its own ceiling (§4.5). Because a
session that commits without finishing counts as a stall, a *healthy* run can legitimately take
`threshold` sessions per milestone — so the cap is sized from that worst case, not "pending + 2".
When it trips the task **pauses**; it is not an error (E14, AC5).

### 6.3 The driver

```ts
export async function handleExecute(ctx: TaskContext): Promise<void>
```

```
  absPlanPath = path.join(ctx.cwd, ctx.planPath)          // §5.3 — store helpers take absolute
  state  = readState(absPlanPath)
  table  = parseExecutionStatus(read(04_execute.md))      // throws → error, never "nothing pending"
  loop   = { table, currentId: null, stalls: 0, sessionsThisDrive: 0,
             sessionCap: sessionCap(table), resumedAt: state.resumed_at ?? null, lastOutcome: null }

  forever:
    step = decideNextStep(loop)
    switch step.kind:
      complete → updateStage(ai_qa); commitAll(); log; return
      pause    → await pause(ctx, loop, step); return
      run      → log.info(`Executing ${row.id} (attempt ${loop.stalls + 1}/${threshold}, ${remaining} remaining)`)
                 before  = await repoSnapshot(git, ctx.planPath)
                 message = await runAndStream({ … })                    // return value NO LONGER discarded
                 hash    = await commitAll(git, `vibe-racer: ${row.id} for #${n}`, ctx.cwd)
                 after   = await repoSnapshot(git, ctx.planPath)
                 table   = parseExecutionStatus(read(04_execute.md))    // re-read, re-parse
                 loop    = foldOutcome({ …loop, table }, {
                             rowId: row.id, statusAfter: rowStatus(table, row.id),
                             doneCountBefore, doneCountAfter: doneCount(table),
                             repoChanged: changed(before, after), finalMessage: message })
                 if (loop.resumedAt === row.id && rowStatus(table, row.id) === "done")
                   clearResumedAt(absPlanPath)                          // §6.3 below
```

**Clearing `resumed_at`.** `LoopState.resumedAt` is read once at loop entry, but the *stored*
field has to be unset once the resumed row finishes, or a later `drive` that meets a row with
that same ID silently applies threshold 1 to it and charges the operator a pause they did not
earn. The `run` branch is the only place that knows, so it clears the field the moment that row
reaches `done`. `pauseForOperator` clears it on the other exit (§5.3). The `complete` branch does
not need to: a task advancing to `ai_qa` never reads the field again.

**Honest logging (§4.6).** The ID comes from the table, never from a `milestone++` counter. A
commit is reported only when `hash` is non-empty; when it is empty the line states what actually
happened — `${row.id} — no pipeline commit (agent committed ${n} of its own)` or
`${row.id} — nothing to commit`. The dishonest `agent already committed` line does not survive
in any form.

**"Made no changes" is a repository question, not a `commitAll` question (§5.4).** New helper:

```ts
// src/git/operations.ts
export async function repoSnapshot(git: SimpleGit, ignorePrefix?: string):
  Promise<{ head: string; dirtyFiles: string[] }>;
```

`repoChanged = before.head !== after.head || !sameSet(before.dirtyFiles, after.dirtyFiles)`,
with paths under `ctx.planPath` excluded — otherwise the agent flipping its own status cell would
read as "made changes" and the pause block would print the wrong sentence. `commitAll` returning
nothing is **not** evidence of a stall, because the agent may have committed for itself.

`repoChanged` feeds only the block's `stallKind` (`"no_changes"` vs `"committed_unfinished"`,
§5.4). **The stall decision itself is judged on the row and nothing else** (§4.3) — the two must
not be conflated.

### 6.4 `pause(ctx, loop, step)` — the effect, in order (§8.4)

1. Build `PauseBlockInput` for `step.cause` (§6.5 below), then
   `content = normalisePauseBlock(content + renderPauseBlock(input), …)` — or normalise in place
   when the agent already wrote a block for this row (`agent_declared`).
2. `content = setMilestoneStatus(content, row.id, "needs_operator")`; write `04_execute.md`.
3. `pauseForOperator(path.join(ctx.cwd, ctx.planPath), { milestone: row.id, reason: input.why })`
   — absolute, per the §5.3 path convention.
4. `commitAll(git, \`vibe-racer: paused for operator at ${row.id} for #${n}\`)`.
5. Print the pit-board message (§7.2).

**The state write comes before the commit** (§8.4), unlike other stages where it is swept up by
the next lap. A pause can last days and the operator's work at a gate is usually git work —
branch switching, rebasing, merging. A paused task must leave a **clean working tree**, or the
operator's first `git checkout` trips over a dirty `state.yml`.

### 6.5 Block content by cause (§5.3)

| `PauseCause` | `items` | `verification` | `why` |
|---|---|---|---|
| `planned_gate` | `extractGateSection(03_plan.md, row.id)?.items` ?? generic | from the same section | the gate's name |
| `agent_declared` | the agent's own block, normalised | its own line | the agent's one-sentence why |
| `legacy_blocked` | generic | `null` | `${id} — marked \`blocked\` by an earlier run` + extra note (§9.3) |
| `stall` | generic item + the agent's message quoted | `null` | `${id} — no progress in N sessions` |
| `session_cap` | generic item | `null` | the §4.5 safety-limit sentence |

Generic item (§5.3): *"Resolve the issue described above (or edit the milestone in the Execution
Status table)"*. We do **not** try to turn prose into a multi-item checklist — a wrong checklist
is worse than an honest generic one.

`extraNotes` carries the two conditional lines: *"This playbook predates operator gates; add a
gate row to the Execution Status table if this step is yours"* — emitted **only** on a `stall`
pause when `!hasOwnerColumn(table)` (§9.3) — and the legacy-`blocked` line.

`isRepause` is set when `state.resumed_at === row.id`, producing the §6.2 wording
(*"Pause 2 (G1 again): verification failed — …"*) so the operator never has to diff two blocks.

---

## 7. Module: `src/state/advancement.ts`

> Source: **Q6**. Split the decision, share the entry point.

### 7.1 Delegation

```ts
export async function tryAdvance(planPath, currentStage, cwd): Promise<AdvancementResult> {
  if (currentStage === "need_operator") return resumeFromOperatorPause(planPath, cwd);
  …generic path, unchanged but for the null-next guard below…
}
```

`tryAdvance` keeps its signature and stays the single call site `drive` uses. The generic path
keeps its shape: its `validateAnswers` call would be actively wrong on a playbook (there are no
`**Answer:**` markers), and bolting conditionals onto it is how that function becomes
unreadable (Q6).

**One defensive change to the generic path, and it is not optional.** `advancement.ts:59-64`
reads `const next = nextStage(currentStage); if (next) updateStage(…); return { advanced: true, … }`
— the `null` case guards the write but **not** the return. For a stage inside `STAGE_ORDER` that
is harmless. For a stage *outside* it that owns a `STAGE_QUESTIONS_FILE` entry it is a permanent
false success: `drive` logs "advanced", changes nothing, and does it again on every invocation,
forever. This task introduces exactly such a stage, and the `need_operator` delegation one line
above is currently the only thing standing between it and that bug — a single forgotten early
return reopens it. So the generic path returns `{ advanced: false, reason: "no_next_stage" }`
when `nextStage` yields `null`, which closes the hazard class instead of routing around it.

**`AdvancementResult.reason` is a closed string union and must grow by three, in one commit.**
It reads today:

```ts
reason: "no_questions_file" | "no_marker" | "incomplete_answers" | "incomplete_checklist" | "advanced";
```

and becomes:

```ts
reason: "no_questions_file" | "no_marker" | "incomplete_answers" | "incomplete_checklist"
      | "advanced" | "resumed" | "no_next_stage" | "unparsable_table";
```

`"resumed"` (§7.2), `"no_next_stage"` (the guard above) and `"unparsable_table"` (§7.2) all land
in M3 alongside the returns that produce them — a member added late is a `tsc` failure in the
milestone that returns it. `advanced` stays `true` for a resume so `drive`'s existing state
re-read fires; it is `false` for the other two.

### 7.2 `resumeFromOperatorPause(planPath, cwd)`

In order (Q6):

1. `findLastPauseBlock` → `null` ⇒ `{ advanced: false, reason: "no_marker" }`. Defensive: a
   paused task always has one.
2. `readPauseBlockState`:
   - marker unticked ⇒ `no_marker` (E8/E9 fall out here — only the **last** block is read);
   - marker ticked **with** unticked items ⇒ `untickResumeMarker`, log each outstanding item with
     its line number, return `incomplete_checklist`. **No session is started** (E7, AC7). This is
     deliberately the same feel as `need_decision` today.
3. Settle the paused row via `setMilestoneStatus`, **guarded by the current status** (§6.5, AC9):

   | Row as the operator left it | Action |
   |---|---|
   | operator gate, still `pending` or `needs_operator` | → `done` |
   | agent row, still `needs_operator` | → `pending` (retry, with verification) |
   | anything else — hand-edited to `done`, renamed, renumbered, deleted | **leave alone** |

4. `resumeFromOperator(path.join(cwd, planPath))` — absolute, per the §5.3 path convention —
   → stage back to `paused_stage`, `operator_*` cleared, `resumed_at` set to the returned
   milestone so the handler applies threshold 1 (§6.2).

**A parse failure here does not throw.** Step 3 needs the row's current status, so it calls
`parseExecutionStatus` and can raise `ExecutionTableError`. `tryAdvance` runs inside `drive`'s
un-wrapped advancement loop (`drive.ts:59-74`), so an escaping throw aborts `driveCommand` for
**every** task before any is selected — the opposite of what AC12 asks for, and from the
operator's seat indistinguishable from vibe-racer being broken. `resumeFromOperatorPause`
therefore catches it, logs the message with the file and line, and returns
`{ advanced: false, reason: "unparsable_table" }`. The task stays at `need_operator` with its
marker ticked; the operator fixes the table and drives again. Turning an unparseable table into
`stage: error` stays the execute handler's job (§10.3), where the task is the one being
dispatched and `withErrorHandling` is in the stack.

### 7.3 Gate announcement at `need_execution` (AC14)

In the generic path, after a successful advance out of `need_execution`, parse `04_execute.md`
and log `operatorGates(table)`:

```
This plan contains 2 operator gates: G1, G2
```

or `This plan contains no operator gates — execution runs start to finish.` It does **not** block
and does **not** ask for a second confirmation — the tick is the consent (§3.4).

**A parse failure here is logged as a warning and never blocks advancement.** The execute
handler is where an unparseable table must become an error (AC12) with a message the operator can
act on; failing the sign-off tick instead would strand the task at a stage whose marker is
already ticked.

---

## 8. Prompt layer

> Source: **Q1** (spec interpolation), §4.7, §7.5, §11.

### 8.1 `planReviewPrompt`

- The File-2 section interpolates `EXECUTION_TABLE_SPEC` **verbatim** instead of hand-writing the
  column list and status values (Q1.1). `blocked` disappears from the prompt automatically.
- New rule with the categories listed explicitly (§3.2): *any action vibe-racer must not or
  cannot take is its own row with `Owner = operator`, never prose between rows* — push, open or
  merge a PR, code review, deploy, release, run a workflow, manual visual or screenshot checks,
  soak and wait periods, secrets, credentials, external dashboards and services, anything outside
  the repository.
- Gate IDs are `G<n>` (§3.3).
- Each gate row gets a matching section in `03_plan.md` — heading `## G<n> — <name>`, a `- [ ]`
  checklist of concrete actions, and a `**Verification:**` line — in the shape
  `extractGateSection` reads (§4.3). Gates with nothing checkable carry
  `**Verification:** None — operator's word` (§6.3).
- `04_execute.md` gains an **"Operator gates" summary section immediately above the `# Complete`
  checkbox** (§3.4), which reads *"None — execution runs start to finish without you."* when
  there are no gates. An explicit "none" is a promise the operator can hold the plan to.
- *"running continuously without pausing"* becomes *"running continuously **between operator
  gates**"* (§3.5).

### 8.2 `executeMilestonePrompt`

- Interpolates `EXECUTION_TABLE_SPEC` and `PAUSE_BLOCK_SPEC`, so an agent-authored block matches
  what `normalisePauseBlock` expects.
- **The `needs_operator` protocol**: if the first unfinished milestone — or anything it depends
  on — needs an action you must not or cannot take, do **not** attempt it, do **not** work around
  it, do **not** start a later milestone. Set the row's status to `needs_operator`, append an
  Operator actions block in exactly the given format, and end the session.
- **The explicit rule**: *"You never push, open PRs, merge PRs or deploy."* Today this lives only
  in whatever the plan happened to write.
- **Gate verification before a dependent milestone**, with the §6.4 fallback ladder: run the
  read-only check from `03_plan.md` (`git fetch`, `git log`, `git merge-base`, `gh pr view`); if
  it cannot run, fall back to local refs; if that is inconclusive, **take the operator's tick as
  the answer and say so in the session output**. A sandboxed operator (`--network none`) must be
  able to pass a gate (E13).

### 8.3 `qaPrompt` (§11, AC19)

Signature becomes `qaPrompt(ctx, gates: string[])`. `handleQa` parses `04_execute.md` and passes
`operatorGates(table).map(r => \`${r.id} — ${r.name}\`)`; a parse failure yields `[]` and a
warning — **the QA lap must not die on a malformed table** that execution already sailed past.

When `gates` is non-empty the prompt requires the report to open with its coverage:
*"This task paused at G1 (PRs merged into main). Work merged before that gate is outside
`git diff main...HEAD` and was not reviewed here."* This makes the known QA-scope limitation
**visible**; fixing it is an explicit follow-up (§13.2), out of scope here.

### 8.4 `chatPrompt` (§7.5, AC18)

```ts
CHAT_PERSONA_MAP.need_operator = PERSONAS.softwareEngineer;
CHAT_ROLE_DESCRIPTIONS.need_operator =
  "The task is paused waiting on you. Read the last 'Operator actions' block in 04_execute.md. " +
  "Explain what the gate needs and why, help reword or split the milestone, and help edit the " +
  "Execution Status table if the step is not one vibe-racer can take.";
```

Guardrail line for this stage: *"Do not push, open PRs, merge or deploy, and do not tick the
resume marker — that is the operator's."*

**Be precise about what enforces this: nothing but the prompt.** `radio` spawns the operator's
own interactive `claude` CLI; `canUseTool`, Rule 0 and the path jail do not run there (§7.5).
That is true of `radio` at every stage today, not new here — but the security declaration must
not describe it as a guarantee (finding S2, §12.3).

---

## 9. CLI layer

### 9.1 `src/cli/drive.ts`

**Same-invocation continuation needs no new plumbing** (Q6). `drive` already runs `tryAdvance`
over human-stage tasks *before* selecting an agent-stage task, and already re-reads state after
advancing (`drive.ts:68`). A task resumed to `ready_to_execute` is therefore eligible for
selection in that same pass. AC7 is satisfied by returning to an agent stage.

What does change:

- `result.reason === "resumed"` prints resume wording, not `advanced from [need_operator]`.
- `ineligibleMessage` special-cases `need_operator`: *"Task #N is paused waiting on the operator —
  see `<planPath>/04_execute.md`."* Never the words "error" or "failed" (§7.4).
- The "waiting on human" listing splits into **"Waiting on operator"** (printed first) and
  "Waiting on human", with the hint naming the real marker from `STAGE_QUESTIONS_FILE[stage].markerText`:
  `#5 [need_operator] — G1: PRs 0,1,2,9,3 not merged → tick "Operator actions complete — resume execution" in plans/0005_infinite-loop-fix/04_execute.md`
- `--retry`'s filter (`stage === "error"`) **stays exactly as-is**, so it never picks up a paused
  task (§4.1, AC15).

**Branch awareness (E17).** `drive` runs the advancement pass on whatever branch is checked out
and only checks out the task branch afterwards. At a gate the operator has usually just been on
`main` merging PRs, where this task's `state.yml` is older or absent and the tick is invisible.
**v1 does not reorder `drive`; it makes the failure legible.** The pause block and the pit-board
message name the branch, and when `drive` ends with nothing to do while the current branch is not
a `vibe-racer/*` branch but such branches exist, it adds one line:

> Task state lives on each task's branch — if you paused a task, check out its `vibe-racer/…`
> branch and run `drive` again.

This needs one new helper, `currentBranch(git)`, next to the existing `getVibeRacerBranches`.
Checking out *before* advancing is the real fix; it is recorded as a follow-up (§17).

### 9.2 `src/cli/pitwall.ts` (§7.1)

A **"Waiting on operator"** group, listed **above** the ordinary pit-stop group, because it
blocks a lap that was already paid for:

```
Waiting on operator:
  #5 infinite-loop-fix — paused at G1: PRs 0,1,2,9,3 not merged
     → edit plans/0005_infinite-loop-fix/04_execute.md
```

Rendered from `Task.operatorMilestone` / `Task.operatorReason` — **no file parsing in the CLI
layer** (Q6). `humanTasks` excludes `need_operator` so a paused task appears exactly once. Styling
is `log.info`/neutral-amber, never `log.error`; the words "error" and "failed" never appear for a
pause (§7.4, AC15).

### 9.3 `src/cli/radio.ts`

**No code change.** `radio` filters on `isHumanStage`, which `need_operator` now satisfies
(§5.2). The whole of AC18 lands in `chatPrompt` (§8.4).

---

## 10. Integration patterns

### 10.1 Claude Agent SDK (`src/claude/session.ts`)

**No change to `runAndStream`.** Two existing behaviours become load-bearing:

- **Its return value is the session's final message.** Today `handleExecute` discards it; from
  now on it is threaded into the pause effect. That single thread is the difference between AC1
  passing and passing *usefully* (Q5) — it is the text that told the operator how to unblock.
- **`LAP_BY_STAGE` is a stage→lap bijection.** `need_operator` gets **no** entry: it is a human
  stage and no session ever runs at it, so no skills resolve for it. Sessions during execution
  continue to run at `stage: "ready_to_execute"` with the `execute` lap and its `simplify` skill.

`allowedTools` for the execute session is unchanged: `["Read", "Glob", "Grep", "Write", "Edit", "Bash"]`.
No `maxTurns` — a session that throws or exhausts its budget goes to `error` via
`withErrorHandling`, as today; **a crash is not a stall** (§4.4, E4).

### 10.2 Tool guard (`src/claude/guard.ts`)

**Unchanged. This is a constraint, not an oversight** (§11, AC21). Rule 0 already denies
`Write`/`Edit` to any `state.yml` under `plans_dir` at every stage, which is precisely what keeps
`state.yml` pipeline-owned while the agent signals through `04_execute.md` (§8.2).

Guard enforcement of the no-push rule is a named follow-up (§13.1) with a hard requirement
attached: `git fetch`, `gh pr view` and `gh pr list` must stay allowed, or gate verification
(§6.1) breaks.

### 10.3 Error handling (`safe-wrapper.ts`)

Also unchanged. `ExecutionTableError` is an ordinary `Error`; `withErrorHandling` catches it,
commits partial work, calls `setError("ready_to_execute", message)` and rethrows. That is exactly
the E1/AC12 behaviour — **the task errors with a message naming the file and what was expected,
and never jumps silently to `ai_qa`.**

A pause is **not** routed through this path. It is a normal return from `handleExecute`.

### 10.4 Git (`src/git/operations.ts`)

Two additions, both small and both used by one caller:

```ts
export async function repoSnapshot(git: SimpleGit, ignorePrefix?: string):
  Promise<{ head: string; dirtyFiles: string[] }>;
export async function currentBranch(git: SimpleGit): Promise<string>;
```

`commitAll` is unchanged, including its pre-commit secret scan — which now also covers the
agent's prose inside a pause block, since that block is staged content like any other (§12.4).

---

## 11. Data flows

### 11.1 Gate declaration (plan lap → sign-off)

```
ai_plan_review ──► agent writes 03_plan.md      (## G1 — … + checklist + **Verification:**)
                              04_execute.md     (table with Owner column + "Operator gates" section)
               ──► need_execution
operator ticks "Ready to advance to Execution"
drive ──► tryAdvance (generic path) ──► parse table ──► log "This plan contains 2 operator gates: G1, G2"
       ──► ready_to_execute
```

### 11.2 Pause (the reported bug, AC1)

```
handleExecute
  parse 04_execute.md ─────────────────────────────► ExecutionTable
  decideNextStep → run(M9)
  repoSnapshot(before) ─► runAndStream ─► commitAll ─► repoSnapshot(after) ─► re-parse
  foldOutcome: M9 still pending, repo unchanged     ─► stalls = 1
  decideNextStep → run(M9)                           (attempt 2/2)
  foldOutcome                                        ─► stalls = 2
  decideNextStep → pause(M9, "stall")
     ├─ renderPauseBlock({ stallKind: "no_changes", agentMessage: <final message> })
     ├─ normalisePauseBlock  ── every box unticked, number and ID correct
     ├─ setMilestoneStatus(M9, needs_operator)      ── write 04_execute.md
     ├─ pauseForOperator({ milestone: "M9", reason: "M9 — no progress in 2 sessions" })
     ├─ commitAll("vibe-racer: paused for operator at M9 for #5")   ── clean tree
     └─ pit board
```

On today's code this sequence never terminates. The test that proves the fix asserts
`runAndStream` was called **exactly twice** and the stage is `need_operator`.

### 11.3 Resume (AC7)

```
operator ticks items + "Operator actions complete — resume execution", runs drive
drive ──► advancement pass (need_operator is a human stage)
       ──► resumeFromOperatorPause
             findLastPauseBlock ─► readPauseBlockState
               ├─ unticked item  → untickResumeMarker + list + STOP (no session)
               └─ all ticked     → setMilestoneStatus(G1 → done)
                                   resumeFromOperator ─► stage = ready_to_execute, resumed_at = "G1"
       ──► task.stage re-read ─► isAgentStage ─► selected in the SAME invocation
       ──► checkout branch ─► dispatch(ready_to_execute) ─► handleExecute
             thresholdFor("G1", resumedAt="G1") = 1        ← the overrule rule
```

### 11.4 Zero-cost planned gate (AC3)

```
parse ─► firstUnfinished = G1, owner = operator ─► decideNextStep → pause(G1, "planned_gate")
                                                    runAndStream NEVER called
```

---

## 12. Configuration and environment

### 12.1 No new configuration (§9.1)

| Knob | Decision |
|---|---|
| Stall threshold | Exported constant `MAX_STALLED_SESSIONS = 2`. **No `.vibe-racer.yml` key, no CLI flag** |
| Session cap | Derived: `pendingAgentRows × MAX_STALLED_SESSIONS + SESSION_CAP_SLACK` |
| Gate verification mode | Agent-side, fixed in v1 |

`src/config/schema.ts` is untouched. If nobody asks for a threshold key, it never needs to exist.

### 12.2 No new prerequisites (§9.2)

- No new runtime dependencies.
- No new tool permissions; the guard is untouched.
- `gh` remains **optional** — gates whose verification needs it degrade to "could not check" and
  fall back to the operator's tick (§6.4, E13).

### 12.3 Backward compatibility (§9.3)

**No migration and no per-run warning** (a warning the operator cannot act on is noise):

- Rows with no Owner column ⇒ every row `agent`. `plans/0001`–`0004` keep parsing and rendering.
- Old playbooks are protected by the **run-time** safety net: an undeclared human-owned step
  pauses after two sessions like any other stall.
- **Only** on a stall pause with `!hasOwnerColumn(table)` does the block add the
  *"predates operator gates"* line (AC13).
- Legacy `blocked` rows pause rather than skip, and the block says *"marked `blocked` by an
  earlier run"* so the operator understands why a task that used to sail past now stops (AC11).

---

## 13. Testing strategy

### 13.1 Shape

The decomposition exists so that the tests that matter need no mocks. Roughly:

| Layer | Style | Mocks |
|---|---|---|
| `execute-table.ts` | pure unit + real-playbook fixtures | none |
| `operator-block.ts` | pure unit + adversarial round-trip | none |
| `decideNextStep` / `foldOutcome` | **table-driven**, one row per AC | none |
| `handleExecute` driver | integration | `runAndStream`, `git`, `fs` |
| `resumeFromOperatorPause` | integration on a temp dir | real `fs`, no SDK |
| `states.ts` invariant | pure | none |

**A test for AC1 must not need the SDK, git and the filesystem mocked at once** — that is the
test nobody maintains (Q5). Only a couple of driver tests stub `runAndStream`.

### 13.2 The tests that must exist

**`tests/pipeline/execute-table.test.ts`**
- Fixture parse of the **real** `plans/0002`, `0003`, `0004` tables (copied into
  `tests/fixtures/playbooks/`), including `plans/0004`'s multi-paragraph Notes cells with inline
  code and its `M5a`/`M5b` IDs.
- Tolerance: casing, backticks, bold, whitespace, extra columns, missing alignment row, `—`,
  escaped pipes, pipes inside backtick spans.
- Missing Owner column ⇒ all rows `agent`.
- `blocked` ⇒ `needs_operator` + `legacyBlocked: true`.
- Throws, **asserting the message**: no heading; no table; no Milestone column; no Status column;
  zero rows; unknown status (message names line and value).
- `pending` in a Milestone Summary table or in prose is **not** counted (E3).
- `setMilestoneStatus` preserves the rest of the line byte-for-byte; absent row ⇒ no-op.
- **Contract test (I1):** every `MILESTONE_STATUSES` and `OWNERS` value appears in the rendered
  plan prompt and execute prompt; the example inside `EXECUTION_TABLE_SPEC` round-trips.

**`tests/pipeline/operator-block.test.ts`**
- **The adversarial round-trip (mandatory, Q3):** render a block whose `agentMessage` contains a
  ticked resume marker, a `- [ ]` item, a `## Operator actions — pause 9 (M1)` heading and a
  stray `~~~`; assert `findLastPauseBlock` still finds the real block and `readPauseBlockState`
  reports the real items only.
- `readPauseBlockState` reads the **last** block only (AC8: an earlier fully-ticked block does
  not resume).
- `normalisePauseBlock` unticks a pre-ticked agent block, fixes the heading number, and
  re-renders when the §5.2 minimum is missing.
- Every cause renders all five guaranteed elements, including with `agentMessage: null` (E5).
- `untickResumeMarker` touches only the marker.
- `extractGateSection` finds `## G1 — …`, `### G1: …`; returns `null` when absent.

**`tests/pipeline/handlers/execute.test.ts`**
- Table-driven over `decideNextStep`/`foldOutcome`:
  AC1 (unchanged table → `pause`, cause `stall`, after exactly 2 sessions);
  AC2 (`needs_operator` → pause after 1); AC3 (operator row → pause, `kind: "pause"` before any
  `run`); AC4 (M1 done then M2 stalling pauses at **M2**); AC5 (cap trips → `pause`, not throw);
  AC6 (`resumedAt === row.id` ⇒ threshold 1); vanished row judged by `doneCount`.
- Driver integration with `runAndStream` stubbed: **`runAndStream` called exactly twice** then
  `stage: need_operator` and the final message present in `04_execute.md` — *the test that would
  hang on today's code*; `runAndStream` **not called at all** for a planned gate;
  `repoChanged` drives `stallKind` wording; no parsable table ⇒ throws, and `ai_qa` is never
  written (AC12).

**`tests/state/advancement.test.ts`**
- Ticked "Ready to advance to Execution" alone does **not** resume (AC8).
- Ticked marker in an earlier block only does **not** resume (AC8).
- Unticked item ⇒ marker unticked, items listed, stage unchanged, no session (AC7).
- Operator row ⇒ `done`; agent row ⇒ `pending`; hand-edited `done` / renamed / deleted row left
  alone (AC9).
- `resumed_at` is written on resume and cleared when the row completes.
- `need_execution` advance logs the gate list; a malformed table there warns and still advances.
- **An unparseable table at resume returns `unparsable_table`, does not throw, and leaves the
  task at `need_operator`** (§7.2) — asserted by driving a paused fixture whose table has been
  mangled, and checking that the call returns rather than rejects.
- **The generic path returns `advanced: false` for a stage with no next stage** (§7.1) — the
  regression test for the `advanced: true`-on-`null` false success, written so it fails if the
  `need_operator` delegation is ever removed.

**`tests/pipeline/states.test.ts`**
- **The `(file, markerText)` injectivity test (AC20).** It asserts uniqueness of the *pair*, not
  of `file` alone, and **must fail** if someone later points `need_operator` at the
  `Ready to advance` marker — that is the issue-#3 stale-tick regression in its new form.
- `need_operator` ∉ `STAGE_ORDER`; `isHumanStage("need_operator") === true`;
  `STAGE_NEXT_NAME.need_operator === undefined`.

**`tests/state/store.test.ts`** — `writeState` sets `prev = next = paused_stage`;
`pauseForOperator`/`resumeFromOperator`/`clearResumedAt` field lifecycle.

**`tests/cli/drive.test.ts`, `tests/cli/pitwall.test.ts`** — the operator group renders reason,
milestone and file; output contains neither "error" nor "failed" for a pause (AC15);
`--retry` does not select a paused task.

**`tests/claude/prompts.test.ts`** — plan prompt mentions the Owner column, `G<n>`, the gate
categories and the "Operator gates" section; execute prompt mentions `needs_operator`, the
no-push/no-PR/no-deploy rule and gate verification; `qaPrompt` includes the coverage requirement
when gates are passed; `chatPrompt("need_operator")` carries the pause role description.

### 13.3 Non-negotiables

1. The AC1 test is written **first** and must be observed to hang (or be reasoned to hang)
   against the current `handleExecute`.
2. No test may depend on a live SDK session or the network.
3. Fixtures are copies of the real playbooks — a parser that passes synthetic tables and fails
   `plans/0004` is a parser that breaks in-flight tasks.

---

## 14. Build and distribution

Unchanged. `tsup` → `dist/`, `vitest run`, `tsc --noEmit`, `eslint src/`. Two new source files
are picked up automatically by the existing entry config; no new build steps, no new bundler
inputs, no `package.json` change. **The `CHANGELOG.md` entry is written in execution, not by the
cleanup lap** — the plan lap moved it into M7 so QA can judge it (plan Q6). The cleanup lap must
not add a second entry for this task.

**Every milestone ends with a passing `npm run build`, `npm run typecheck`, `npm run test` and
`npm run lint`** (objective constraint).

Distribution-visible surface: a new CLI stage name in `pitwall`/`drive` output, and new sections
in `CLAUDE.md`, `docs/how-it-works.md` and `CHANGELOG.md` (§11 in scope). `docs/how-it-works.md`'s
"Execution Loop" section is **already out of date** — it describes one session and checkboxes,
not one session per milestone against a status table — and this task rewrites it around the real
loop plus the `need_operator` detour, including the known QA-scope limitation (§13.2, AC21).

---

## 15. Dependency summary

**No new runtime dependencies** (objective constraint). Nothing is added to `package.json`.

| Existing dependency | Used by this change | New usage? |
|---|---|---|
| `zod` | `stateSchema` gains four optional fields | no |
| `yaml` | `state.yml` read/write | no |
| `simple-git` | `repoSnapshot`, `currentBranch` | new calls on the existing client |
| `@anthropic-ai/claude-agent-sdk` | `runAndStream` — return value now consumed | no |
| `commander`, `chalk`, `ora` | CLI output for the operator group | no |
| `vitest` (dev) | two new test files, new fixtures | no |

Internal dependency direction stays acyclic and one-way:

```
execute-table.ts ──┐
                   ├──► handlers/execute.ts ──► claude/session.ts, git/operations.ts, state/store.ts
operator-block.ts ─┤
                   ├──► state/advancement.ts ──► state/store.ts
                   └──► claude/prompts.ts        (constants + spec blocks only)
states.ts ─────────────► state/store.ts, state/advancement.ts, cli/drive.ts
```

`execute-table.ts` and `operator-block.ts` import **nothing** from the pipeline or state layers —
that is what keeps them mock-free under test.

---

## 16. Traceability matrix

| AC | Where it lives | Proven by |
|---|---|---|
| 1 Reported case cannot recur | `decideNextStep` stall branch + driver pause | `execute.test.ts` (2 sessions then `need_operator`) |
| 2 `needs_operator` → 1 session | `decideNextStep` | table-driven |
| 3 Operator row → 0 sessions | `decideNextStep` ordering | `runAndStream` not called |
| 4 Progress resets stalls | `foldOutcome` | table-driven |
| 5 Cap pauses, not errors | `sessionCap` + `"session_cap"` cause | table-driven |
| 6 Overrule ⇒ threshold 1 | `thresholdFor` + `resumed_at` | table-driven + store test |
| 7 Resume in same invocation | `resumeFromOperatorPause` + `drive`'s existing pass | `advancement.test.ts`, `drive.test.ts` |
| 8 Stale ticks do not resume | `readPauseBlockState` (last block, fence-aware) | `operator-block.test.ts` |
| 9 Hand edits respected | status-guarded `setMilestoneStatus`; no-op on absent row | `advancement.test.ts` |
| 10 Re-pause wording | `isRepause` | `operator-block.test.ts` |
| 11 Legacy `blocked` pauses | alias + `legacyBlocked` + `extraNotes` | `execute-table.test.ts` |
| 12 Unparseable table errors | `ExecutionTableError` + `withErrorHandling` | message assertions |
| 13 No-Owner playbook runs | Owner default + `hasOwnerColumn` line | fixtures |
| 14 Gates listed at sign-off | plan prompt section + `tryAdvance` log | `prompts.test.ts`, `advancement.test.ts` |
| 15 `pitwall`/`drive` visibility | `Task.operator*`, operator group, marker text | CLI tests |
| 16 Block is self-sufficient | `renderPauseBlock` defaults | per-cause render tests |
| 17 Stall kind + inert quote | `stallKind`, blockquote + fence | round-trip test |
| 18 `radio` at a pause | `chatPrompt` maps | `prompts.test.ts` |
| 19 QA states coverage | `qaPrompt(ctx, gates)` | `prompts.test.ts` |
| 20 `(file, marker)` invariant | `STAGE_QUESTIONS_FILE` shape + `CLAUDE.md` | `states.test.ts` |
| 21 Guard unchanged | no diff in `guard.ts` | review + `docs/how-it-works.md` |
| 22 Security declaration reviewed | last execution milestone, docs only | §12 checklist |

---

## 17. Risks and deferred decisions

| # | Risk | Mitigation / decision |
|---|---|---|
| R1 | The parser is stricter than reality and errors a healthy in-flight task | Fixtures are the **real** `plans/0002`–`0004` tables; tolerance list in §3.3 is explicit; `setMilestoneStatus` no-ops rather than throws |
| R2 | An agent writes a pause block that resumes its own task | Two independent layers (§4.4) plus unconditional `normalisePauseBlock` (§4.5); the round-trip test is mandatory |
| R3 | `drive` run from `main` cannot see the tick (E17) | **v1 makes it legible, not fixed**: branch named in the block, the pit board and the nothing-to-do hint. Reordering `drive` to check out before advancing is the real fix — **recorded as a follow-up**; the design review may instead accept it into this task (Q6) |
| R4 | Session cap trips on a healthy long run | Sized from the worst case (`pending × threshold + slack`), computed once; tripping pauses rather than errors |
| R5 | `MAX_STALLED_SESSIONS` is wrong for some workload | Exported constant, single call site, no config key until someone asks (§9.1) |
| R6 | QA reviews a fraction of the task after a mid-task merge | Out of scope; made **visible** via `qaPrompt` coverage line and a documented limitation. Follow-up task §13.2 |
| R7 | The no-push rule remains prompt-only | Out of scope by product decision (Q6b). Follow-up task §13.1, with `git fetch`/`gh pr view`/`gh pr list` as a stated requirement |

### Deferred by explicit product decision (do not implement here)

Automating operator work · guard enforcement of no-push · handler-run gate verification ·
a threshold config key · a migration or per-run warning for pre-Owner playbooks · an
"abandon task" command · parallel or out-of-order execution · retry/backoff for genuine session
errors.

