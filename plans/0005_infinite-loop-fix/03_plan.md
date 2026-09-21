# Implementation Plan — #5: infinite-loop-fix

> **Role**: Senior Software Engineer
> **Stage**: `ai_plan_review` → `need_execution`
> **Date**: 2026-09-21
> **Inputs**: `00_objective.md`, `01_product.md`, `02_design.md`, `03_plan_questions.md` (Q1–Q6),
> `execute_infinite_loop_bug.md` (root-cause spec, deleted in M7)

Citations below: **AC n** = product spec §14 acceptance criteria · **§n.n** = design spec sections ·
**PQn** = plan question answers · **En** = product spec §10 edge cases.

**Baseline before M1**: 31 test files, 449 tests, all green (`npm run test`, 2026-09-21).

---

## Table of contents

1. [Implementation strategy](#1-implementation-strategy)
2. [Milestone overview](#2-milestone-overview)
3. [M1 — Table contract + parser](#3-m1--table-contract--parser)
4. [M2 — Pause-block format](#4-m2--pause-block-format)
5. [M3 — State layer + resume path](#5-m3--state-layer--resume-path)
6. [M4 — Operator surfaces](#6-m4--operator-surfaces)
7. [M5 — The loop](#7-m5--the-loop)
8. [M6 — Prompts](#8-m6--prompts)
9. [M7 — Docs + housekeeping](#9-m7--docs--housekeeping)
10. [M8 — Security declaration review](#10-m8--security-declaration-review)
11. [Dependency graph](#11-dependency-graph)
12. [Test strategy](#12-test-strategy)
13. [Plan-level decisions that complete the design](#13-plan-level-decisions-that-complete-the-design)
14. [Traceability: AC → milestone](#14-traceability-ac--milestone)

---

## 1. Implementation strategy

### The ordering rule

**Everything that consumes `need_operator` lands before the only thing that produces it** (PQ1).

The obvious build order is "fix the loop first — it is the bug". It is also the wrong one. The
moment `handleExecute` can write `stage: need_operator`, every layer that reads state has to
already understand it: `stateSchema` must accept it or `discoverTasks` swallows the task in its
bare `catch` (`discovery.ts:42-44`) and it vanishes from `pitwall` and `drive` with no error
anywhere; `tryAdvance` must delegate it or the task takes the generic path and reports a false
`advanced: true` forever; `pitwall` must group it or the operator sees a bare `[need_operator]`
with no reason and no marker hint.

So the producer (M5) is fifth, not first. Half of that ordering is enforced by `tsc` rather than
by discipline — M5 cannot compile before M3, because `pauseForOperator` lives in `store.ts` and
`"need_operator"` is not a `Stage` until `schema.ts` grows it. The other half is not, and is
called out in M3 and M4 below.

### Build order in one line

Two pure modules (M1, M2) → the state layer that consumes them (M3) → the surfaces that display
them (M4) → the loop that produces them (M5) → the prompts that instruct the agent (M6) → docs
and housekeeping (M7) → the security declaration, strictly last and docs-only (M8).

### Four seams, four milestones

The design's decomposition (§1.1) exists so the tests that matter need no mocks. The milestone
boundaries follow it exactly:

| Seam | Milestone | Purity |
|---|---|---|
| CONTRACT — the status table | M1 | Pure. String in, structure out |
| FORMAT — the pause block | M2 | Pure. Structure in, markdown out |
| DECISION — `decideNextStep` / `foldOutcome` | M5 (first half) | Pure. `LoopState` → `Step` |
| EFFECTS — driver, resume, CLI | M3, M4, M5 (second half) | SDK, git, `state.yml`, terminal |

**M1 and M2 are pure modules with no callers**, so they end green by construction. That is not an
accident of ordering — it is why AC1 can be a table-driven assertion with zero mocks (§13.1).

### The three hazards this plan handles explicitly

**H1 — a split M3 (PQ1).** `states.ts`'s `STAGE_QUESTIONS_FILE.need_operator` entry and
`advancement.ts`'s `need_operator` delegation look separable and are not. Land the map entry
without the delegation and every paused task takes the *generic* path: it finds the ticked
"Ready to advance to Execution" left over from sign-off, passes `validateAnswers` vacuously (a
playbook has no `**Answer:**` markers, so nothing is unanswered), gets `null` from
`nextStage("need_operator")` — and `tryAdvance` returns `advanced: true` anyway, because
`advancement.ts:59-64` guards the `updateStage` call with that `null` but not the return. A false
success on every `drive`, forever. **The map entry, the delegation and the null-next guard go in
one commit (M3)**, and the guard closes the hazard class rather than stepping around it.

**H2 — the live cutover (PQ2).** vibe-racer executes this task with the code this task changes.
M5 replaces the running loop — but not at the moment it commits: `handleExecute` is a
`while (true)` inside a Node process that imported the module at startup, and the installed CLI
runs `dist/`, not `src/`. The cutover is an explicit, operator-owned step documented in M5's row
in `04_execute.md`, not an agent task — an agent session is a *child* of the `drive` process and
cannot interrupt its own parent. Missing the window breaks nothing; it only loses the live
exercise of AC13.

**H3 — this task's own playbook predates operator gates (PQ2.5).** `03_plan.md` and
`04_execute.md` for task #5 are written under the **old** plan prompt: no Owner column, no gate
rows. That is deliberate and load-bearing in two directions. Forward: M1–M5 run under the old
regex loop, and an `Owner = operator` row with status `pending` would make that loop spin on it
forever — literally the bug being fixed. Backward: it makes this task's own playbook the AC13
fixture, which M5 parses in a dry read before the cutover. The plan lap does **not** retro-fit
its own inputs.

### Reuse posture

This task adds two source modules and rewrites one. Everything else is an extension of code that
already exists, following the conventions already in the tree:

- **Reused unchanged**: `withErrorHandling`, `setError`, `commitAll`, `createGit`,
  `checkoutBranch`, `getVibeRacerBranches`, `runAndStream` (its return value stops being
  discarded — no signature change), the guard in its entirety, `selectTask`, `log.*`.
- **Extended in place**: `stateSchema`, `writeState`, `Task`, `tryAdvance`, `STAGE_QUESTIONS_FILE`,
  `driveCommand`, `pitWallCommand`, `planReviewPrompt`, `executeMilestonePrompt`, `qaPrompt`,
  `CHAT_*_MAP`.
- **Deliberately not reused**: `validateDecisionChecklist` (§4.4) — it matches *indented* `- [ ]`
  items on purpose, because at `need_decision` an indented unworked item must still block. Pause
  blocks need the opposite rule: an indented or blockquoted `- [ ]` inside the agent's quoted
  message must be inert. Two functions with opposite indentation rules must not be one function.
  `validation.ts` is untouched by this task.
- **Deleted, not shimmed**: `countPendingMilestones`, the `milestone++` session counter, the
  `Milestone N — agent already committed` log line, `blocked` from the plan prompt's status list,
  the string-valued `STAGE_QUESTIONS_FILE`, and `execute_infinite_loop_bug.md`.

---

## 2. Milestone overview

| # | Name | Key output | Depends on |
|---|---|---|---|
| **M1** | Table contract + parser | `src/pipeline/execute-table.ts` + fixtures | — |
| **M2** | Pause-block format | `src/pipeline/operator-block.ts` | — |
| **M3** | State layer + resume path | `need_operator` exists end to end, minus its producer | M1, M2 |
| **M4** | Operator surfaces | `drive` / `pitwall` show a pause | M3 |
| **M5** | **The loop** | `handleExecute` rewritten — **AC1 lands here** | M1, M2, M3 (M4 by ordering) |
| **M6** | Prompts | Plan / execute / QA / chat prompts + contract test | M1, M2, M5 |
| **M7** | Docs + housekeeping | `CLAUDE.md`, `how-it-works.md`, `CHANGELOG.md`, follow-ups | M1–M6 |
| **M8** | Security declaration review | `docs/security.md`, `SECURITY.md`, `README.md` — **docs only** | M1–M7 |

Every milestone ends with `npm run build`, `npm run typecheck`, `npm run test` and `npm run lint`
green, and is committed on its own (objective constraint, §14).

---

## 3. M1 — Table contract + parser

### Goal

One module owns the Execution Status table: what it legally contains, how to read it, and how to
write a single cell back. Pure — no `fs`, no `git`, no logging, no imports from the pipeline or
state layers. That purity is what keeps it mock-free under test and what lets `prompts.ts`
interpolate its spec without a cycle (§15).

### Code reuse

| | |
|---|---|
| **Reused** | Error-class shape from `SecretDetectedError` (`git/operations.ts:21-27`): extends `Error`, sets `this.name`, carries structured fields. Const-tuple-plus-derived-type idiom from `STAGES`/`Stage` (`state/schema.ts:3-22`). |
| **Extended** | Nothing — no existing module parses markdown tables. |
| **Genuinely new** | The whole module. The nearest existing thing is `countPendingMilestones` (`handlers/execute.ts:12-14`), a 2-line regex count that **M5 deletes**; it is superseded, not extended, and no shim remains. |
| **Not touched** | `validation.ts` keeps its current exports and its current tests. Giving it table knowledge would couple every stage to the execute lap (§2). |

### Tasks

1. **Create `src/pipeline/execute-table.ts`** with the contract (§3.1):

   ```ts
   export const MILESTONE_STATUSES = ["pending", "in_progress", "done", "needs_operator"] as const;
   export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

   export const OWNERS = ["agent", "operator"] as const;
   export type Owner = (typeof OWNERS)[number];

   /** Describes gates in the prompt and labels them in logs. NEVER used to classify a row. */
   export const GATE_ID_PATTERN = /^G\d+$/;

   export const EXECUTION_STATUS_HEADING = "Execution Status";
   export const EXECUTION_PLAYBOOK_FILE = "04_execute.md";
   ```

   `blocked` is **not** in the union. It survives only as a parser-internal alias (task 5).
   **A row is a gate because `owner === "operator"`, never because of how its ID is spelled.**
   IDs are never validated — `plans/0004` already ships `M5a`/`M5b`, and the operator may
   renumber by hand while paused (§6.5, E12).

2. **Data model** (§3.2), exported as interfaces:

   ```ts
   export interface MilestoneRow {
     id: string;              // "M9" | "G1" | "M5a" | whatever the operator wrote
     name: string;
     owner: Owner;            // defaults to "agent" when there is no Owner column
     status: MilestoneStatus;
     commit?: string;
     notes?: string;
     lineIndex: number;       // absolute 0-based line in the file — setMilestoneStatus writes here
     legacyBlocked: boolean;  // this row literally said `blocked`
   }

   export interface ColumnMap {
     milestone: number;       // required
     status: number;          // required
     name?: number;
     owner?: number;          // absent ⇒ every row is agent-owned (§12.3)
     commit?: number;
     notes?: number;
   }

   export interface ExecutionTable {
     rows: MilestoneRow[];
     headerLineIndex: number;
     columns: ColumnMap;
   }

   export class ExecutionTableError extends Error {
     constructor(message: string, readonly file?: string, readonly line?: number) {
       super(message);
       this.name = "ExecutionTableError";
     }
   }
   ```

3. **`parseExecutionStatus(content: string, file = EXECUTION_PLAYBOOK_FILE): ExecutionTable`** (§3.3).

   - **Locate the table.** Scan for the first markdown heading (`/^#{1,6}\s+(.*)$/`) whose text
     contains `EXECUTION_STATUS_HEADING` case-insensitively. Take the first pipe table after it.
     The table ends at the first blank line or the next heading. **Nothing outside that table is
     ever read** — this alone fixes E3 (a `pending` in the Milestone Summary table or in prose
     keeping the loop alive).
   - **Split cells with `splitRow(line: string): string[]`** (module-private): honours `\|`
     escapes and backtick spans. A naive `line.split("|")` breaks on `plans/0004`, whose Notes
     cells hold prose with inline code.
   - **Normalise a cell with `normaliseCell(raw: string): string`** (module-private):
     `trim → strip surrounding backticks → strip bold markers → trim → lowercase` for matching;
     the un-lowercased form is kept for `name`/`notes`/`commit`.
   - **Resolve columns by header name, not position**: match each normalised header against
     `milestone | name | owner | status | commit | notes`. Extra columns are ignored, not an error.
     A missing `Owner` column leaves `columns.owner` undefined.
   - **Skip the alignment row** (`/^\|[\s:|-]+\|$/`) when present; an absent one is tolerated.
   - **Tolerate** (§3.3): any case, surrounding backticks, bold (`**done**`), leading/trailing
     whitespace, extra columns, absent alignment row, `—` or empty cells, pipes inside cells.

   **Throws `ExecutionTableError` when** — and the message quality is part of AC12, so each
   message names the listed facts:

   | Condition | Message names |
   |---|---|
   | No "Execution Status" heading | the file, and that the heading is required |
   | No pipe table under the heading | the file, the heading's line |
   | No `Milestone` **or** no `Status` column | the file, the header line, the headers it did find |
   | Zero data rows | the file, the header line |
   | Row status not in the union after normalisation | the file, the offending line **and** value, and the legal values |
   | Owner cell neither `agent` nor `operator` (see §13, D3) | the file, the offending line **and** value, and `agent \| operator` |

4. **Owner resolution.** No Owner column ⇒ every row `agent`. With the column: empty / `—` /
   `agent` ⇒ `agent`; `operator` ⇒ `operator`; anything else throws (§13, D3).

5. **Legacy `blocked`** (§3.4):

   ```ts
   const LEGACY_STATUS_ALIASES: Record<string, MilestoneStatus> = { blocked: "needs_operator" };
   ```

   A `blocked` row parses to `status: "needs_operator"`, `legacyBlocked: true`. The status union
   never grows a fifth member; M5 reads `legacyBlocked` to add the *"marked `blocked` by an
   earlier run"* line to the pause block. **AC11.**

6. **Mutation and derived queries** (§3.5):

   ```ts
   export function setMilestoneStatus(content: string, id: string, status: MilestoneStatus): string;
   export function firstUnfinished(table: ExecutionTable): MilestoneRow | null;   // status !== "done"
   export function rowStatus(table: ExecutionTable, id: string): MilestoneStatus | null;
   export function operatorGates(table: ExecutionTable): MilestoneRow[];          // owner === "operator"
   export function pendingAgentRows(table: ExecutionTable): MilestoneRow[];
   export function doneCount(table: ExecutionTable): number;
   export function hasOwnerColumn(table: ExecutionTable): boolean;
   ```

   `setMilestoneStatus` rewrites **only the status cell on that row's line**, byte-preserving the
   rest: the operator's own column alignment and Notes prose live on that same line. It preserves
   the cell's padding and its backtick wrapper (`` `pending` `` → `` `done` ``). **An absent row
   is a no-op, not an error** — the operator may have deleted or renumbered the row while paused,
   and a hand edit must never break resume (E11, E12, AC9).

   `rowStatus` is not in the design's §3.5 list but the §6.3 driver pseudocode calls it; it lives
   here rather than in the handler so no table query is reimplemented outside this module.

7. **`EXECUTION_TABLE_SPEC`** (§3.6) — a template literal built **from** `MILESTONE_STATUSES` and
   `OWNERS`, never a hand-written copy. It contains the header row, the meaning of each column,
   the legal status values, the gate-row rule, and a worked example. Both prompts interpolate it
   verbatim in M6, so adding a status to the union changes the prompts automatically. Today's bug
   is partly a drift bug — `blocked` existed in the plan prompt and meant nothing to the handler.

8. **Fixtures — `tests/fixtures/playbooks/`** (PQ4). Snapshots, never live reads:

   | File | Source | Pins |
   |---|---|---|
   | `0002-status.md` | `plans/0002_add-a-consolidate-function` | Real table, no Owner column, `—` cells |
   | `0003-status.md` | `plans/0003_fasten-2026-04-16` | Real table, full-width alignment row, prose Notes |
   | `0004-status.md` | `plans/0004_add-qa-step` | **The important one** — `M5a`/`M5b` IDs, Notes with inline code and quotes |
   | `no-heading.md` | synthetic | Throw: no `Execution Status` heading |
   | `unknown-status.md` | synthetic | Throw naming line + value (AC12) |
   | `legacy-blocked.md` | synthetic | `blocked` → `needs_operator` + `legacyBlocked` (AC11) |
   | `pending-in-summary-only.md` | synthetic | **E3** — front matter, prose, and a Milestone Summary table *above* the `## Execution Status` heading, **and a prose paragraph between that heading and its table** |

   Copy the `## Execution Status` **section only**, not the whole playbook. Each fixture opens
   with an HTML comment naming its source path and the commit it was taken from.
   `pending-in-summary-only.md` is the one that carries full-file shape — every other fixture is a
   bare status section, which never exercises "scan for the **first** matching heading". A parser
   that simply grabs the first pipe table in the file passes all the others. It must also put a
   **prose paragraph between the heading and the table**, because that is the shape of this task's
   own `04_execute.md`: a parser that treats the first blank line after the heading as the end of
   the table would pass every other fixture here and then fail M5's dry read — four milestones
   after this parser froze.
   **Tests never read `plans/` at run time**: a consumer repo has different plans, and this very
   task appends pause blocks to `plans/0005/04_execute.md`.

### Test requirements — `tests/pipeline/execute-table.test.ts`

- Parse of all three **real** playbook fixtures: correct row count, IDs (including `M5a`/`M5b`),
  statuses, and Notes cells that contain inline code and prose.
- Tolerance matrix: casing, backticks, bold, whitespace, extra columns, missing alignment row,
  `—`, escaped pipes, pipes inside backtick spans.
- Missing Owner column ⇒ every row `owner: "agent"`, `hasOwnerColumn() === false`.
- `blocked` ⇒ `status: "needs_operator"`, `legacyBlocked: true`.
- Throws with **asserted message text**: no heading; no table; no Milestone column; no Status
  column; zero rows; unknown status (names line and value); unknown owner (names line and value).
- `pending` in a Milestone Summary table or in prose is **not** counted (E3).
- `setMilestoneStatus`: preserves the rest of the line byte-for-byte; preserves backtick wrapper
  and padding; absent row ⇒ content returned unchanged.
- Derived queries: `firstUnfinished` skips `done` and returns the first of anything else;
  `operatorGates`; `pendingAgentRows`; `doneCount`; `rowStatus` on a present and an absent row.
- **The example table inside `EXECUTION_TABLE_SPEC` round-trips through `parseExecutionStatus`.**
  (The other half of the contract test — that every union member appears in the rendered prompts —
  lands in M6 with the prompts it asserts on.)

---

## 4. M2 — Pause-block format

### Goal

One module owns the pause block end to end: render, find, read, normalise. **Nothing else in the
codebase knows the block's shape.** Pure — the handler owns file I/O. Two independent layers make
agent prose structurally inert, so a session cannot resume its own task through its final message.

### Code reuse

| | |
|---|---|
| **Reused** | The `completionSection(nextName)` idiom from `validation.ts:80-86` — a pure function returning markdown that a caller appends — is the pattern `renderPauseBlock` follows. |
| **Extended** | Nothing. |
| **Genuinely new** | The whole module, including the fence-aware scanner. |
| **Deliberately duplicated, with the reason recorded in a comment** | Checkbox scanning. `validateDecisionChecklist` (`validation.ts:117-132`) matches **indented** `- [ ]` on purpose; `readPauseBlockState` must **not**, because a `- [ ]` behind `> ` inside a quoted agent message is not an operator item (§4.4). The comment in `readPauseBlockState` names `validateDecisionChecklist` and states the opposite rule, so the next reader does not "consolidate" them and reopen E6. |

### Tasks

1. **Create `src/pipeline/operator-block.ts`** with the constants (§4.1):

   ```ts
   export const OPERATOR_RESUME_MARKER = "Operator actions complete — resume execution";
   export const PAUSE_HEADING_PATTERN = /^## Operator actions — pause (\d+) \(([^)]+)\)/;
   export const PAUSE_BLOCK_SPEC: string;   // quoted verbatim by executeMilestonePrompt in M6
   ```

   The marker is deliberately **not** `Ready to advance …`: `04_execute.md` already carries the
   ticked "Ready to advance to Execution" from sign-off, and sharing the marker would resume the
   task instantly — the stale-tick failure issue #3 fixed (§5.6, AC8).

2. **Types** (§4.2): `PauseCause` (`"planned_gate" | "agent_declared" | "stall" | "session_cap" |
   "legacy_blocked"`), `StallKind` (`"no_changes" | "committed_unfinished"`), `PauseBlockInput`,
   `PauseBlockLocation`, `PauseBlockState`, exactly as the design gives them.

3. **`renderPauseBlock(input: PauseBlockInput): string`** — **the single renderer for all five
   causes**, which is what makes the §5.2 guaranteed minimum structurally impossible to omit. It
   fills every default itself:
   - no `verification` ⇒ *"None — the agent will simply retry"*;
   - no `agentMessage` ⇒ *"The agent left no closing message; see the terminal log or the last
     commits"* (E5) — never an empty quote;
   - empty `items` ⇒ the generic item *"Resolve the issue described above (or edit the milestone
     in the Execution Status table)"*;
   - always the resume marker and the closing line naming `branchName` (E17).

   `isRepause` produces the *"G1 again"* wording (§6.2, AC10). `stallKind` selects *"made no
   changes in N sessions"* vs *"committed work in N sessions but did not finish"* (§5.4, AC17).
   `extraNotes` lines are rendered under the why.

4. **Inertness, layer 1 — fence + blockquote** (§4.4). The agent's message is rendered inside a
   `~` fence **and** every line is prefixed `> `. The fence run is longer than the longest `~` run
   in the message (minimum 3), so a message containing a fence cannot break out. **The fence is
   for rendering; the blockquote prefix is what makes the text inert**, because a `- [ ]` behind
   `> ` is never at a position the scanner accepts.

5. **Inertness, layer 2 — a fence-aware scanner.** `readPauseBlockState(content): PauseBlockState | null`
   walks **only the last block's lines**, tracks fence state (both ``` ` ``` and `~` runs, matching
   run length), and skips any line inside a fence and any line starting with `>`. It recognises
   the resume marker only when it is an **unindented** `- [ ]`/`- [x]` whose text equals
   `OPERATOR_RESUME_MARKER`. Scoping to the last block is what makes AC8 true by construction
   rather than by a regex that happens to match the right thing.

6. **The rest of the exported surface** (§4.3):

   ```ts
   export function findLastPauseBlock(content: string): PauseBlockLocation | null;
   export function untickResumeMarker(content: string): string;
   export function nextPauseNumber(content: string): number;   // last + 1, else 1
   export function normalisePauseBlock(
     content: string,
     ctx: { pauseNumber: number; rowId: string; branchName: string },
   ): string;
   export function extractGateSection(planMarkdown: string, gateId: string):
     { items: string[]; verification: string | null } | null;
   ```

7. **`normalisePauseBlock` runs on every pause regardless of who wrote the block** (§4.5).
   Quoting covers the agent's *message*; it does not cover a block the agent *authored* — which
   could arrive with every box and the resume marker already ticked, a wrong pause number, or no
   marker at all. In order:
   1. untick every checkbox in the last block, **including the resume marker**;
   2. correct the heading's pause number and row ID;
   3. ensure the closing line names the task branch (E17);
   4. if the §5.2 minimum is not met — no marker, no actionable item, no closing line — **lift the
      agent's items and re-render through `renderPauseBlock`**.

   "Structurally impossible to omit" is only true once every block has been through the renderer
   or the normaliser.

8. **`extractGateSection`** locates a heading in `03_plan.md` whose text begins with the gate ID
   (`## G1 — …`, `### G1: …`), collects the `- [ ]` items under it and the `**Verification:**`
   line. Returns `null` when the plan has no such section — the handler then falls back to the
   generic item (§5.3). It lives here, not in `execute-table.ts`, because its only consumer is
   pause-block construction and its return type is a slice of `PauseBlockInput`.

### Test requirements — `tests/pipeline/operator-block.test.ts`

- **The adversarial round-trip (mandatory, §13.2).** Render a block whose `agentMessage` contains
  a *ticked* resume marker, a `- [ ]` item, a `## Operator actions — pause 9 (M1)` heading and a
  stray `~~~`. Assert `findLastPauseBlock` still finds the **real** block and
  `readPauseBlockState` reports the real items only, with `markerTicked === false`.
- `readPauseBlockState` reads the **last** block only: an earlier, fully-ticked block does not
  report as ticked (AC8).
- `normalisePauseBlock` unticks a pre-ticked agent block, fixes the heading number and row ID,
  adds the closing line, and re-renders when the §5.2 minimum is missing.
- Every `PauseCause` renders all five guaranteed elements — including with `agentMessage: null`
  (E5), `verification: null`, and `items: []`.
- `isRepause` wording (AC10); `stallKind` wording both ways (AC17); `extraNotes` rendered.
- `untickResumeMarker` touches only the marker, leaving item checkboxes as they were.
- `nextPauseNumber`: 1 on a block-free file, last + 1 otherwise.
- `extractGateSection` finds `## G1 — …` and `### G1: …`, returns `null` when absent, and returns
  `verification: null` when the section has no `**Verification:**` line.

---

## 5. M3 — State layer + resume path

### Goal

`need_operator` exists end to end — schema, stage machine, store helpers, task discovery, resume
— **minus its producer**. After this milestone a hand-written `stage: need_operator` in a
`state.yml` is a fully legal, fully recoverable state. Nothing produces one yet.

### Code reuse

| | |
|---|---|
| **Reused** | The `error` branch in `writeState` (`store.ts:20-28`) is the exact model for the `need_operator` branch. The `trivial` field on `Task` (`discovery.ts:12,40`) is the exact model for `operatorReason`/`operatorMilestone`. `updateStage`'s read-modify-write shape is the model for the three new helpers. The `removeCompletionMarker` + `log.warn` + `return { advanced: false }` shape at `advancement.ts:47-57` (the `need_decision` checklist path) is the model for the unticked-item path — deliberately the same feel for the operator. |
| **Extended** | `stateSchema`, `STAGES`, `STAGE_ORDER`, `STAGE_QUESTIONS_FILE`, `Task`, `tryAdvance`, `AdvancementResult.reason`. |
| **Consolidated** | The `(STAGES as readonly string[]).includes(x)` test is written inline at `store.ts:21` and again at `drive.ts:138`. M3 extracts `validStage(s: string \| undefined): Stage \| null` in `store.ts`, uses it in both `writeState` branches, and exports it so `drive.ts` uses it too — the second branch would otherwise be a third copy. |
| **Genuinely new** | `pauseForOperator`, `resumeFromOperator`, `clearResumedAt`, `resumeFromOperatorPause`. |

### Tasks

1. **`src/state/schema.ts`** (§5.1): add `"need_operator"` to `STAGES`, positioned after
   `"ready_to_execute"` for readability — **the position is inert**, because M3 also excludes the
   stage from `STAGE_ORDER`. Add four optional fields to `stateSchema`:

   ```ts
   paused_stage: z.enum(STAGES).optional(),   // where to return to — always ready_to_execute in v1
   operator_reason: z.string().optional(),    // the one-line reason (§7.3)
   operator_milestone: z.string().optional(), // the paused row's ID
   resumed_at: z.string().optional(),         // row ID just resumed — drives threshold 1
   ```

   The pause fields are **not** folded into `error_stage`/`error_message`: `pitwall` and `drive`
   must tell a pause from a failure without string-inspecting a stage name, and a task can
   legitimately error *while* it carries pause fields. `resumed_at` is persisted rather than
   threaded through `TaskContext` because `drive` dispatches **one** task per invocation, chosen
   *after* the advancement pass — with two actionable tasks the resumed one may not run until a
   later `drive`, and an in-memory value would silently restore threshold 2.

2. **`src/pipeline/states.ts`** (§5.2):

   ```ts
   const NON_LINEAR_STAGES = new Set<Stage>(["error", "need_operator"]);
   const STAGE_ORDER: Stage[] = STAGES.filter((s) => !NON_LINEAR_STAGES.has(s));
   ```

   Replacing `STAGES.filter(s => s !== "error")` with a named set makes the next detour stage a
   one-line change and names the intent. `isHumanStage` then returns `true` for `need_operator`
   for free — which is what makes `radio` work at a pause with no new plumbing (§9.3) and what
   puts a paused task into `drive`'s advancement pass. `isAgentStage` is untouched.

3. **`STAGE_QUESTIONS_FILE` becomes a `(file, markerText)` map** — **one map, not two parallel
   ones, because two maps can disagree**:

   ```ts
   export interface StageQuestions { file: string; markerText: string }

   export const STAGE_QUESTIONS_FILE: Partial<Record<Stage, StageQuestions>> = {
     need_objective: { file: "00_objective.md",         markerText: "Ready to advance to Objective Review" },
     need_product:   { file: "01_product_questions.md", markerText: "Ready to advance to Product Review" },
     need_design:    { file: "02_design_questions.md",  markerText: "Ready to advance to Design Review" },
     need_plan:      { file: "03_plan_questions.md",    markerText: "Ready to advance to Plan Review" },
     need_execution: { file: "04_execute.md",           markerText: "Ready to advance to Execution" },
     need_operator:  { file: "04_execute.md",           markerText: OPERATOR_RESUME_MARKER },
     fine_tuning:    { file: "05_qa.md",                markerText: "Ready to advance to Cleanup" },
     need_decision:  { file: "06_decision.md",          markerText: "Ready to advance to Done" },
   };
   ```

   `states.ts` imports `OPERATOR_RESUME_MARKER` from `operator-block.ts`, which imports nothing
   back — the dependency stays one-way (§15).

   **`STAGE_NEXT_NAME` gets no `need_operator` entry.** Every consumer builds
   `"Ready to advance to ${name}"`, which is exactly the wording §7.2 forbids for a pause.

   **`hasCompletionMarker` / `removeCompletionMarker` keep their signatures and their hard-coded
   `Ready to advance` regex, and are never called for `need_operator`** (task 6 routes that stage
   elsewhere). Parameterising them would touch every handler call site for no behavioural gain, in
   the one file where a slip re-opens issue #3.

4. **Fix all three call sites of the map in the same commit** (verified by grep):
   `advancement.ts:24`, `drive.ts:100-101`, `tests/pipeline/states.test.ts:95-103` — each switches
   from `STAGE_QUESTIONS_FILE[s]` to `STAGE_QUESTIONS_FILE[s]?.file`. `drive.ts` gets only this
   mechanical fix here; its operator-group output is M4.

5. **`src/state/store.ts`** (§5.3):

   ```ts
   export function validStage(s: string | undefined): Stage | null;
   ```

   `writeState` grows a `need_operator` branch mirroring the `error` one:

   ```ts
   if (state.stage === "error") {
     prev = validStage(state.error_stage);           next = null;
   } else if (state.stage === "need_operator") {
     const paused = validStage(state.paused_stage) ?? "ready_to_execute";
     prev = paused;  next = paused;                  // the detour returns whence it came
   } else {
     prev = previousStage(state.stage);              next = nextStage(state.stage);
   }
   ```

   Without this branch `nextStage("need_operator")` returns `null` (index `-1`) and a paused task
   renders with no forward arrow in `pitwall`.

   Three helpers, so "which fields get cleared on resume" lives in exactly one place:

   ```ts
   export function pauseForOperator(
     planPath: string,
     args: { milestone: string; reason: string; pausedStage?: Stage },
   ): void;
   export function resumeFromOperator(planPath: string): { pausedStage: Stage; milestone?: string };
   export function clearResumedAt(planPath: string): void;
   ```

   - `pauseForOperator` writes `stage: need_operator`, `paused_stage` (default
     `"ready_to_execute"`), `operator_reason`, `operator_milestone`, and **clears `resumed_at`**.
   - `resumeFromOperator` sets `stage` back to `paused_stage`, **returns `operator_milestone`
     before clearing it**, writes `resumed_at: <milestone>`, and clears
     `paused_stage`/`operator_reason`/`operator_milestone`. A forgotten `operator_reason` would
     otherwise haunt `pitwall` for the rest of the task's life.

   **`planPath` for all three is absolute**, and that is not what every existing caller holds.
   The two conventions in this codebase disagree silently: handlers pass repo-relative
   `ctx.planPath` into `updateStage` (`execute.ts:47`), which works only because the process cwd
   is the repo root, while `advancement.ts:61` passes `path.join(cwd, planPath)`. Getting it wrong
   is neither quiet nor contained: `readState` throws `ENOENT`, and `tryAdvance` runs inside the
   un-wrapped `for (const task of tasks)` loop at `drive.ts:59-74` — one bad path takes down
   `drive` for **every** task, before any task is selected. Document the convention in a comment
   above the three helpers.

6. **`src/state/discovery.ts`** (§5.4): `Task` carries the two pause fields, populated from state
   exactly as `trivial` already is, so the CLI layer never parses files:

   ```ts
   export interface Task {
     …
     operatorReason?: string;
     operatorMilestone?: string;
   }
   ```

7. **`src/state/advancement.ts` — delegation and the null-next guard** (§7.1). **This is hazard H1
   and all of it goes in this commit:**

   ```ts
   export async function tryAdvance(planPath, currentStage, cwd): Promise<AdvancementResult> {
     if (currentStage === "need_operator") return resumeFromOperatorPause(planPath, cwd);
     … generic path, unchanged but for the guard below …
   }
   ```

   The generic path keeps its shape — its `validateAnswers` call would be actively wrong on a
   playbook (there are no `**Answer:**` markers), and bolting conditionals onto it is how that
   function becomes unreadable. The **one** change to it is not optional:
   `advancement.ts:59-64` guards the `updateStage` write with `if (next)` but **not** the return.
   Replace with:

   ```ts
   const next = nextStage(currentStage);
   if (!next) return { advanced: false, reason: "no_next_stage" };
   updateStage(path.join(cwd, planPath), next);
   ```

   `AdvancementResult.reason` grows by three **in this commit** — `"resumed"`, `"no_next_stage"`,
   `"unparsable_table"` — so a member added late is a `tsc` failure in the milestone that returns
   it. `advanced` is `true` for `"resumed"` (so `drive`'s existing state re-read fires) and
   `false` for the other two.

8. **`resumeFromOperatorPause(planPath: string, cwd: string): Promise<AdvancementResult>`** (§7.2),
   in order:

   1. `findLastPauseBlock` → `null` ⇒ `{ advanced: false, reason: "no_marker" }`. Defensive: a
      paused task always has one.
   2. `readPauseBlockState`:
      - marker unticked ⇒ `no_marker` (E8 and E9 fall out here for free — **only the last block is
        read**);
      - marker ticked **with** unticked items ⇒ `untickResumeMarker`, log each outstanding item
        with its line number, return `incomplete_checklist`. **No session is started** (E7, AC7).
   3. Settle the paused row via `setMilestoneStatus`, **guarded by its current status** (AC9):

      | Row as the operator left it | Action |
      |---|---|
      | operator gate, still `pending` or `needs_operator` | → `done` |
      | agent row, still `needs_operator` | → `pending` (retry, with verification) |
      | anything else — hand-edited to `done`, renamed, renumbered, deleted | **leave alone** |

   4. `resumeFromOperator(path.join(cwd, planPath))` → stage back to `paused_stage`, `operator_*`
      cleared, `resumed_at` set to the returned milestone so M5 applies threshold 1.
      Return `{ advanced: true, reason: "resumed" }`.

   **A parse failure here does not throw.** Step 3 calls `parseExecutionStatus` and can raise
   `ExecutionTableError`; an escaping throw aborts `driveCommand` for every task before any is
   selected — from the operator's seat indistinguishable from vibe-racer being broken. Catch it,
   log the message with file and line, return `{ advanced: false, reason: "unparsable_table" }`.
   The task stays at `need_operator` with its marker ticked; the operator fixes the table and
   drives again. **Turning an unparseable table into `stage: error` stays the execute handler's
   job** (M5), where the task is the one being dispatched and `withErrorHandling` is in the stack.

9. **Gate announcement at `need_execution`** (§7.3, AC14): in the generic path, after a successful
   advance out of `need_execution`, parse `04_execute.md` and log
   `This plan contains N operator gates: G1, G2` — or
   `This plan contains no operator gates — execution runs start to finish.` It does **not** block
   and does **not** ask for a second confirmation; the tick is the consent. **A parse failure here
   is a warning and never blocks advancement** — failing the sign-off tick would strand the task
   at a stage whose marker is already ticked.

### Test requirements

**`tests/pipeline/states.test.ts`** (extend; update the existing map assertions to `?.file`)
- **The `(file, markerText)` injectivity test (AC20).** Asserts uniqueness of the **pair**, not of
  `file` alone, and **must fail** if someone later points `need_operator` at a `Ready to advance`
  marker — that is the issue-#3 stale-tick regression in its new form.
- `need_operator` ∉ `STAGE_ORDER`; `nextStage("need_operator") === null`;
  `isHumanStage("need_operator") === true`; `isAgentStage("need_operator") === false`;
  `STAGE_NEXT_NAME.need_operator === undefined`.
- Existing stage-order assertions still pass — `error` exclusion is unchanged in behaviour.

**`tests/state/store.test.ts`** (extend)
- `writeState` with `stage: need_operator` sets `prev === next === paused_stage`; with
  `paused_stage` absent or invalid, both default to `ready_to_execute`.
- `pauseForOperator` writes all four fields and clears `resumed_at`.
- `resumeFromOperator` returns the milestone, restores `paused_stage`, writes `resumed_at`, and
  clears `paused_stage`/`operator_reason`/`operator_milestone`.
- `clearResumedAt` removes only `resumed_at`.
- `validStage` on a real stage, an unknown string and `undefined`.

**`tests/state/advancement.test.ts`** (extend, on a temp dir with real `fs`, no SDK)
- Ticked "Ready to advance to Execution" alone does **not** resume (AC8).
- A ticked marker in an **earlier** block only does **not** resume (AC8).
- Unticked item ⇒ marker unticked on disk, items listed, stage unchanged, `incomplete_checklist`
  (AC7).
- Operator gate row ⇒ `done`; agent row ⇒ `pending`; hand-edited `done`, renamed and deleted rows
  left alone (AC9).
- `resumed_at` written on resume.
- `need_execution` advance logs the gate list; a malformed table there warns and **still advances**.
- **An unparseable table at resume returns `unparsable_table`, does not reject, and leaves the
  task at `need_operator`.**
- **The generic path returns `advanced: false` for a stage with no next stage** — written so it
  fails if the `need_operator` delegation is ever removed (H1 regression test).

**`tests/cli/radio.test.ts`** (extend) — `radio` accepts a `need_operator` task as eligible. This
lands here, not in M4: `radio` filters on `isHumanStage` (`radio.ts:60`), which starts returning
`true` for `need_operator` the moment `NON_LINEAR_STAGES` lands in this milestone. Nothing breaks
in between — no task can pause until M5 — but the test belongs beside the change that causes it.

---

## 6. M4 — Operator surfaces

### Goal

`drive` and `pitwall` speak about a pause in the operator's language before anything can produce
one. Cost of this ordering: zero. Cost of skipping it: a paused task that renders as a bare
`[need_operator]` with no reason and no marker hint.

### Code reuse

| | |
|---|---|
| **Reused** | `pitwall`'s group-rendering shape (`log.info` header + indented `console.log` rows, `pitwall.ts:25-47`) is copied for the operator group. `drive`'s existing "Waiting on human input" block (`drive.ts:96-104`) is split rather than duplicated. `getVibeRacerBranches` (`operations.ts:72-77`) is the neighbour `currentBranch` is written next to. |
| **Extended** | `driveCommand`'s `ineligibleMessage` and waiting listing; `pitWallCommand`'s grouping. |
| **Genuinely new** | `currentBranch(git)`; the operator group. |

### Tasks

1. **`src/git/operations.ts`**: `export async function currentBranch(git: SimpleGit): Promise<string>`
   — `(await git.branchLocal()).current`, returning `""` on a detached HEAD or a branch-less repo.

   > **Deviation from PQ1, stated deliberately.** PQ1's table assigns both `repoSnapshot` and
   > `currentBranch` to M5. `currentBranch` has its only caller in **this** milestone (the
   > nothing-to-do branch hint, §9.1), and a milestone that ships a call site for a helper landing
   > two milestones later does not end green. `repoSnapshot`'s only caller is the M5 driver and it
   > stays in M5. Split by call site, not by file.

2. **`src/cli/drive.ts`** (§9.1):
   - `result.reason === "resumed"` prints resume wording
     (`Task #N resumed — continuing execution at <milestone>`), **not** `advanced from
     [need_operator]`.
   - `ineligibleMessage` special-cases `need_operator`: *"Task #N is paused waiting on the
     operator — see `<planPath>/04_execute.md`."* The words "error" and "failed" never appear
     (§7.4, AC15).
   - The waiting listing splits into **"Waiting on operator"** (printed **first**) and "Waiting on
     human". The operator hint names the real marker from `STAGE_QUESTIONS_FILE[stage].markerText`
     and carries reason and file:

     ```
     #5 [need_operator] — G1: PRs 0,1,2,9,3 not merged
        → tick "Operator actions complete — resume execution" in plans/0005_infinite-loop-fix/04_execute.md
     ```

     The human hint keeps today's `STAGE_NEXT_NAME` wording, which is why `need_operator` has no
     entry in that map.
   - **Branch awareness (E17).** When `drive` ends with nothing to do, the current branch is not a
     `vibe-racer/*` branch, and such branches exist, print one line:

     > Task state lives on each task's branch — if you paused a task, check out its
     > `vibe-racer/…` branch and run `drive` again.

     This is the legibility half of E17; reordering `drive` to check out **before** the
     advancement pass is the real fix and is **out of scope** (PQ5) — it changes behaviour for
     every stage and needs its own thinking about dirty trees. It becomes follow-up #3 in M7.
   - **`--retry`'s filter (`stage === "error"`) is not touched**, so it never picks up a paused
     task (AC15).

3. **`src/cli/pitwall.ts`** (§9.2): an **"Waiting on operator"** group listed **above** the
   ordinary pit-stop group, because it blocks a lap that was already paid for. Rendered from
   `Task.operatorMilestone` / `Task.operatorReason` — **no file parsing in the CLI layer**.
   `humanTasks` must now exclude `need_operator` explicitly (it satisfies `isHumanStage` since
   M3), so a paused task appears exactly once. Styling is `log.info`/neutral, never `log.warn`
   and never `log.error`.

   ```
   Waiting on operator:
     #5 infinite-loop-fix — paused at G1: PRs 0,1,2,9,3 not merged
        → edit plans/0005_infinite-loop-fix/04_execute.md
   ```

   The empty-state check at `pitwall.ts:57` must count operator tasks too, or a repo whose only
   active task is paused prints "No active tasks."

4. **`src/cli/radio.ts` — no code change.** `radio` filters on `isHumanStage`, which
   `need_operator` satisfies as of M3. The whole of AC18 lands in `chatPrompt` in M6. Confirm by
   test, not by inspection.

### Test requirements

**`tests/cli/pitwall.test.ts`** (extend)
- A `need_operator` task renders under "Waiting on operator" with its milestone, reason and file.
- It does **not** also appear under "Waiting on human".
- Output for a paused task contains neither "error" nor "failed" (AC15).
- A repo whose only active task is paused does not print "No active tasks".

**`tests/cli/drive.test.ts`** (extend)
- The operator listing names `OPERATOR_RESUME_MARKER`, not "Ready to advance to …".
- `--retry` does not select a `need_operator` task.
- `reason: "resumed"` prints resume wording, not "advanced from".
- `ineligibleMessage` for `need_operator` with `--task N` says "paused waiting on the operator".
- The branch hint appears only when nothing is actionable, the current branch is not
  `vibe-racer/*`, and such branches exist.

---

## 7. M5 — The loop

### Goal

Replace the `while (true)` regex count with a pure decision function and a thin effectful driver.
**This is the only producer of `need_operator`, and AC1 lands here.** Termination becomes
structural: bounded even if the agent ignores every instruction and the parser misreads the table.

### Code reuse

| | |
|---|---|
| **Reused** | `runAndStream` unchanged — **its return value is already the session's final message**; today's handler discards it (`execute.ts:29`), and threading it into the pause is the difference between AC1 passing and passing *usefully*. `commitAll`/`createGit` unchanged, including the pre-commit secret scan, which now also covers the agent's prose inside a pause block. `withErrorHandling` unchanged — `ExecutionTableError` is an ordinary `Error`, so it already produces `stage: error` with the message preserved, which **is** AC12. `ALLOWED_TOOLS` unchanged. No `maxTurns` — a crash is not a stall (E4). |
| **Extended** | `src/git/operations.ts` gains `repoSnapshot`. |
| **Genuinely new** | `decideNextStep`, `foldOutcome`, `thresholdFor`, `sessionCap`, the driver, `pause()`. |
| **Deleted** | `countPendingMilestones` (superseded by `parseExecutionStatus`); the `milestone++` counter (IDs now come from the table); the `Milestone N — agent already committed` line (§4.6 — it reported a stall as progress); the entire current body of `tests/pipeline/handlers/execute.test.ts`, whose four cases all assert the regex-count behaviour being removed. No shim, no compatibility path. |

### Tasks

**Test-first is mandated in this milestone and only in this milestone**, because here the test
*is* the acceptance criterion (PQ3). Everywhere else tests land in the same commit as the code
they cover, per the project's existing convention.

1. **Write the AC1 test first** in `tests/pipeline/handlers/execute.test.ts`: stub `runAndStream`
   to return a fixed final message and leave `04_execute.md` byte-identical. Assert
   `runAndStream.mock.calls.length === 2`, `readState().stage === "need_operator"`, and that the
   stubbed message appears inside the last pause block. Wrap it in vitest's per-test
   `{ timeout: 5_000 }` so a regression fails fast instead of hanging CI.

2. **The evidence run — once, not committed** (PQ3). Before replacing `handleExecute`, run that
   test file against the **old** handler on a scratch commit and capture the timeout output:

   ```bash
   npx vitest run tests/pipeline/handlers/execute.test.ts --testTimeout=5000
   ```

   **Stub `commitAll` as well as `runAndStream` for this run.** The old loop body is
   `readFile → runAndStream → commitAll` (`execute.ts:22-44`), so a stub on `runAndStream` alone
   leaves a real `git add .` + commit firing every iteration against this repository until the
   timeout — hundreds of junk commits on the task branch, in the milestone whose whole job is a
   clean cutover.

   **Do not rely on the timeout to end this run — it cannot fire.** This test file mocks
   `fs/promises` `readFile` with an already-resolved promise (the existing convention), so with
   `runAndStream` and `commitAll` stubbed too, the old `while (true)` awaits nothing but resolved
   promises: a pure microtask spin that never yields to the timers phase. Vitest's per-test
   timeout is a timer, so the worker pegs a core and grows `mock.calls` until the Bash tool kills
   it or Node runs out of heap. **For the evidence run, make the `runAndStream` stub throw after
   50 calls** (`"old loop: 50 sessions on an unchanged table"`), and record that error. It is
   deterministic, finishes in milliseconds, and is better evidence than a timeout. The committed
   AC1 test keeps its `{ timeout: 5_000 }` — the new loop terminates on its own, so there the
   timeout is only a backstop. "Scratch" means *run before the rewrite and commit nothing* — no
   scratch branch, no `git stash`, no reset.

   Paste the captured output into M5's Notes cell in `04_execute.md` — **after stripping any text
   that puts the word pending between two pipes**: the old loop counts that shape anywhere in the
   playbook and would then never terminate. That is the
   artefact QA reads to verify AC1 — a test that hangs cannot be committed, but "would have hung"
   is the whole claim of this task.

3. **`src/git/operations.ts`**:

   ```ts
   export async function repoSnapshot(git: SimpleGit, ignorePrefix?: string):
     Promise<{ head: string; dirtyFiles: string[] }>;
   ```

   `head` from `git.revparse(["HEAD"])` (returning `""` if it throws, e.g. an unborn branch);
   `dirtyFiles` the union of `status()`'s `not_added`, `created`, `modified`, `deleted`,
   `renamed`, `staged`, sorted and de-duplicated, with any path starting with `ignorePrefix`
   removed.

4. **Rewrite `src/pipeline/handlers/execute.ts` — the pure core** (§6.1):

   ```ts
   export const MAX_STALLED_SESSIONS = 2;   // §4.4 — not configurable in v1
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
     statusAfter: MilestoneStatus | null;  // null ⇒ the row vanished mid-session
     doneCountBefore: number;
     doneCountAfter: number;
     repoChanged: boolean;                 // commits or dirty files OUTSIDE the plan dir
     finalMessage: string | null;
   }

   export type Step =
     | { kind: "run";      row: MilestoneRow }
     | { kind: "pause";    row: MilestoneRow; cause: PauseCause }
     | { kind: "complete" };

   export function decideNextStep(state: LoopState): Step;
   export function foldOutcome(state: LoopState, outcome: SessionOutcome): LoopState;
   export function thresholdFor(rowId: string, resumedAt: string | null): number;
   export function sessionCap(table: ExecutionTable): number;
   ```

5. **`decideNextStep` implements §8.3 exactly — the branch order is the specification**:

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

6. **`foldOutcome` — where AC4 lives**:

   ```
   if (statusAfter === "done")                → stalls = 0
   else if (statusAfter === "needs_operator") → stalls = 0   (decide() pauses on the next tick)
   else if (statusAfter === null)             → progress iff doneCountAfter > doneCountBefore
   else                                       → stalls++
   currentId = rowId; sessionsThisDrive++
   ```

   **A row that vanishes mid-session is judged by position, not ID** — if the agent renamed or
   split it, `statusAfter` is `null` and the outcome counts as progress when `doneCount` grew.
   **Never an exception** (E12).

   *The asymmetry this leaves is intended and must be commented, so it is not rediscovered as a
   bug:* when the row is still there but untouched — the agent went and finished a **later**
   milestone instead — `statusAfter` is `"pending"`, so the `doneCount` branch never runs and the
   session counts as a stall. Two of those pause at the first unfinished row while the repository
   visibly moved. That is the intended reading (the row we asked for did not move), out-of-order
   execution is deferred by product decision, and the **wording stays honest** because
   `repoChanged` is true in that case, so the block says *"committed but did not finish"* rather
   than *"made no changes"*.

7. **`thresholdFor(rowId, resumedAt)`** returns `1` when `rowId === resumedAt` (the post-overrule
   rule, AC6) and `MAX_STALLED_SESSIONS` otherwise. The stall threshold is a function of state,
   not a constant.

8. **`sessionCap(table) = pendingAgentRows(table).length * MAX_STALLED_SESSIONS + SESSION_CAP_SLACK`,
   computed once at loop entry** from the initial parse. Computing it per iteration would let a
   growing table raise its own ceiling. Because a session that commits without finishing counts as
   a stall, a *healthy* run can legitimately take `threshold` sessions per milestone — so the cap
   is sized from that worst case, not "pending + 2". **When it trips the task pauses; it is not an
   error** (E14, AC5).

9. **The driver** — `export async function handleExecute(ctx: TaskContext): Promise<void>` (§6.3):

   ```
   absPlanPath = path.join(ctx.cwd, ctx.planPath)     // §5.3 — store helpers take absolute
   state = readState(absPlanPath)
   table = parseExecutionStatus(read(04_execute.md), `${ctx.planPath}/04_execute.md`)
   loop  = { table, currentId: null, stalls: 0, sessionsThisDrive: 0,
             sessionCap: sessionCap(table), resumedAt: state.resumed_at ?? null, lastOutcome: null }

   forever:
     step = decideNextStep(loop)
     complete → updateStage(absPlanPath, "ai_qa"); commitAll(); log; return
     pause    → await pause(ctx, loop, step); return
     run      → log.info(`Executing ${row.id} (attempt ${stalls + 1}/${threshold}, ${remaining} remaining)`)
                before  = await repoSnapshot(git, ctx.planPath)
                message = await runAndStream({ … })              // return value NO LONGER discarded
                hash    = await commitAll(git, `vibe-racer: ${row.id} for #${n}`, ctx.cwd)
                after   = await repoSnapshot(git, ctx.planPath)
                table   = parseExecutionStatus(read(04_execute.md), …)   // re-read, re-parse
                loop    = foldOutcome({ …loop, table }, { … })
                if (loop.resumedAt === row.id && rowStatus(table, row.id) === "done")
                  clearResumedAt(absPlanPath)
   ```

   `parseExecutionStatus` throwing here is the whole of AC12: `withErrorHandling` catches it,
   commits partial work, calls `setError("ready_to_execute", message)` and rethrows — **the task
   errors with a message naming the file and what was expected, and never jumps silently to
   `ai_qa`.** A pause is **not** routed through that path; it is a normal return.

   Use `absPlanPath` for `readState`, `updateStage`, `pauseForOperator` and `clearResumedAt` — one
   path convention in one file, replacing today's relative `updateStage(ctx.planPath, …)`.

10. **Clearing `resumed_at`.** `LoopState.resumedAt` is read once at loop entry, but the *stored*
    field must be unset once the resumed row finishes, or a later `drive` that meets a row with
    that same ID silently applies threshold 1 and charges the operator a pause they did not earn.
    The `run` branch is the only place that knows, so it clears the field the moment that row
    reaches `done`; `pauseForOperator` clears it on the other exit. The `complete` branch does not
    need to — a task advancing to `ai_qa` never reads the field again.

11. **Honest logging** (§4.6). The ID comes from the table, never from a counter. A commit is
    reported only when `hash` is non-empty; when it is empty the line states what actually
    happened — `${row.id} — no pipeline commit (agent committed its own)` or
    `${row.id} — nothing to commit`. The dishonest `agent already committed` line does not survive
    in any form.

12. **`repoChanged` is a repository question, not a `commitAll` question** (§5.4):
    `before.head !== after.head || !sameSet(before.dirtyFiles, after.dirtyFiles)`, with paths under
    `ctx.planPath` excluded — otherwise the agent flipping its own status cell reads as "made
    changes" and the block prints the wrong sentence. `commitAll` returning nothing is **not**
    evidence of a stall, because the agent may have committed for itself.
    **`repoChanged` feeds only the block's `stallKind`. The stall decision itself is judged on the
    row and nothing else** (§4.3) — the two must not be conflated.

13. **`pause(ctx, loop, step)` — the effect, in this order** (§6.4):
    1. Build `PauseBlockInput` for `step.cause` (task 14), then
       `content = normalisePauseBlock(content + renderPauseBlock(input), …)` — or normalise in
       place when the agent already wrote a block for this row (`agent_declared`).
    2. `content = setMilestoneStatus(content, row.id, "needs_operator")`; write `04_execute.md`.
    3. `pauseForOperator(absPlanPath, { milestone: row.id, reason: input.why })`.
    4. `commitAll(git, \`vibe-racer: paused for operator at ${row.id} for #${n}\`, ctx.cwd)`.
    5. Print the pit-board message (§7.2).

    **The state write comes before the commit**, unlike other stages where it is swept up by the
    next lap. A pause can last days and the operator's work at a gate is usually git work —
    branch switching, rebasing, merging. A paused task must leave a **clean working tree**, or the
    operator's first `git checkout` trips over a dirty `state.yml`.

14. **Block content by cause** (§6.5):

    | `PauseCause` | `items` | `verification` | `why` |
    |---|---|---|---|
    | `planned_gate` | `extractGateSection(03_plan.md, row.id)?.items` ?? generic | from the same section | the gate's name |
    | `agent_declared` | the agent's own block, normalised | its own line | the agent's one-sentence why |
    | `legacy_blocked` | generic | `null` | `${id} — marked \`blocked\` by an earlier run` + extra note |
    | `stall` | generic item + the agent's message quoted | `null` | `${id} — no progress in N sessions` |
    | `session_cap` | generic item | `null` | the §4.5 safety-limit sentence |

    `extraNotes` carries the two conditional lines: *"This playbook predates operator gates; add a
    gate row to the Execution Status table if this step is yours"* — emitted **only** on a `stall`
    pause when `!hasOwnerColumn(table)` (AC13) — and the legacy-`blocked` line. `isRepause` is set
    when `state.resumed_at === row.id` (AC10).

15. **The dry read — a scratch script, not committed** (PQ2.2). Once the suite is green, parse
    **this task's own** `plans/0005_infinite-loop-fix/04_execute.md` with the new parser and assert
    the row set matches the table as written (no Owner column, every row `agent`). A parser that
    errors here would send this task to `error` on the operator's next `drive` — AC12 working as
    designed, at the worst possible moment. Record the result in M5's Notes.

16. **`npm run build` — last item in this milestone's task list, and load-bearing.**
    `vibe-racer` on this machine is an `npm link`, so the build overwrites the exact bundle the
    running CLI was loaded from. Without it the cutover in M5's Notes cannot happen.

### Test requirements — `tests/pipeline/handlers/execute.test.ts` (rewritten)

**Table-driven over `decideNextStep`/`foldOutcome`, zero mocks** — one row per criterion:

| Case | Assertion |
|---|---|
| AC1 | Unchanged table → `run`, `run`, then `{ kind: "pause", cause: "stall" }` |
| AC2 | Row `needs_operator` → `pause` / `agent_declared` after exactly 1 session |
| AC3 | First unfinished row `owner: "operator"` → `pause` / `planned_gate` **before** any `run` |
| AC4 | M1 `done` then M2 stalling → pause at **M2**, not M1 |
| AC5 | `sessionsThisDrive >= sessionCap` → `pause` / `session_cap`, never a throw |
| AC6 | `resumedAt === row.id` ⇒ `thresholdFor` returns 1; one stall pauses |
| AC11 | Row `blocked` → `pause` / `legacy_blocked` |
| E12 | `statusAfter: null` with `doneCount` grown ⇒ stalls reset; ungrown ⇒ stalls++ |
| — | `sessionCap` sizing: `pendingAgentRows × 2 + 2` |

**Driver integration with `runAndStream` and `commitAll` stubbed:**
- **`runAndStream` called exactly twice**, then `stage: need_operator` and the stubbed final
  message present in `04_execute.md` — *the test that would hang on today's code* (AC1),
  `{ timeout: 5_000 }`.
- `runAndStream` **not called at all** for a planned gate (AC3).
- `repoChanged` drives `stallKind` wording both ways (AC17).
- An unparsable table **throws** and `updateStage(…, "ai_qa")` is **never** called (AC12).
- A fully-`done` table advances to `ai_qa` (the one behaviour preserved from the old test file).
- `clearResumedAt` is called when the resumed row reaches `done`, and not otherwise.

---

## 8. M6 — Prompts

### Goal

The agent is told the contract that M1–M5 enforce: how the table is shaped, that `needs_operator`
is a legal outcome, that it never pushes, and how to verify a gate. Prompts land **after** the
loop, so nothing instructs the agent to do something the pipeline cannot yet honour.

### Code reuse

| | |
|---|---|
| **Reused** | `EXECUTION_TABLE_SPEC` (M1) and `PAUSE_BLOCK_SPEC` (M2) are **interpolated verbatim** — the prompts never restate the contract. `contextFilesInstruction`, `questionFormat`, `PERSONAS`, the `{ prompt, persona }` return shape: all unchanged. `CHAT_PERSONA_MAP` / `CHAT_ROLE_DESCRIPTIONS` gain one key each, no restructure. |
| **Extended** | `planReviewPrompt`, `executeMilestonePrompt`, `qaPrompt` (signature), `handleQa`. |
| **Genuinely new** | Nothing structural. |
| **Deleted** | The hand-written status list `` `pending` \| `in_progress` \| `done` \| `blocked` `` in `planReviewPrompt` (prompts.ts:415) — replaced by the interpolated spec, which is how `blocked` disappears from the prompt automatically and cannot drift back. |

### Tasks

1. **`planReviewPrompt`** (§8.1):
   - Interpolate `EXECUTION_TABLE_SPEC` **verbatim** in the File-2 section, replacing the
     hand-written column list and status values.
   - New rule with the categories stated explicitly: *any action vibe-racer must not or cannot
     take is its own row with `Owner = operator`, never prose between rows* — push, open or merge
     a PR, code review, deploy, release, run a workflow, manual visual or screenshot checks, soak
     and wait periods, secrets, credentials, external dashboards and services, anything outside
     the repository.
   - Gate IDs are `G<n>`.
   - Each gate row gets a matching section in `03_plan.md` — heading `## G<n> — <name>`, a `- [ ]`
     checklist of concrete actions, and a `**Verification:**` line — **in the shape
     `extractGateSection` reads**. Gates with nothing checkable carry
     `**Verification:** None — operator's word`.
   - `04_execute.md` gains an **"Operator gates" summary section immediately above the
     `# Complete` checkbox**, which reads *"None — execution runs start to finish without you."*
     when there are no gates. An explicit "none" is a promise the operator can hold the plan to
     (AC14, E15).
   - *"running continuously without pausing"* becomes *"running continuously **between operator
     gates**"*.

2. **`executeMilestonePrompt`** (§8.2):
   - Interpolate `EXECUTION_TABLE_SPEC` and `PAUSE_BLOCK_SPEC`, so an agent-authored block matches
     what `normalisePauseBlock` expects.
   - **The `needs_operator` protocol**: if the first unfinished milestone — or anything it depends
     on — needs an action you must not or cannot take, do **not** attempt it, do **not** work
     around it, do **not** start a later milestone. Set the row's status to `needs_operator`,
     append an Operator actions block in exactly the given format, and end the session.
   - **The explicit rule**: *"You never push, open PRs, merge PRs or deploy."* Today this lives
     only in whatever the plan happened to write.
   - **Gate verification before a dependent milestone**, with the fallback ladder: run the
     read-only check from `03_plan.md` (`git fetch`, `git log`, `git merge-base`, `gh pr view`);
     if it cannot run, fall back to local refs; if that is inconclusive, **take the operator's tick
     as the answer and say so in the session output**. A sandboxed operator (`--network none`)
     must be able to pass a gate (E13).
   - Step 2 stops saying "find the FIRST `pending` milestone" and says "the milestone named in this
     prompt" — the handler already decided which row, and the two must not disagree.

3. **`qaPrompt(ctx: TaskContext, gates: string[])`** (§8.3) and `handleQa`: the handler parses
   `04_execute.md` and passes ``operatorGates(table).map(r => `${r.id} — ${r.name}`)``.
   **A parse failure yields `[]` and a warning** — the QA lap must not die on a malformed table
   that execution already sailed past. When `gates` is non-empty the prompt requires the report to
   open with its coverage: *"This task paused at G1 (PRs merged into main). Work merged before
   that gate is outside `git diff main...HEAD` and was not reviewed here."* (AC19). Grep for other
   `qaPrompt` callers before changing the signature.

4. **`chatPrompt`** (§8.4, AC18):

   ```ts
   CHAT_PERSONA_MAP.need_operator = PERSONAS.softwareEngineer;
   CHAT_ROLE_DESCRIPTIONS.need_operator =
     "The task is paused waiting on you. Read the last 'Operator actions' block in 04_execute.md. " +
     "Explain what the gate needs and why, help reword or split the milestone, and help edit the " +
     "Execution Status table if the step is not one vibe-racer can take.";
   ```

   Plus a guardrail line for this stage: *"Do not push, open PRs, merge or deploy, and do not tick
   the resume marker — that is the operator's."* **Be precise about what enforces this: nothing
   but the prompt.** `radio` spawns the operator's own interactive `claude` CLI; `canUseTool`,
   Rule 0 and the path jail do not run there. That is true of `radio` at every stage today, not
   new here — but M8 must not describe it as a guarantee.

5. **`LAP_BY_STAGE` gets no `need_operator` entry** (§10.1) — it is a human stage and no session
   runs at it, so no skills resolve for it. Confirm by test; change nothing.

### Test requirements — `tests/claude/prompts.test.ts` (extend)

- **The contract test (I1), the other half of M1's**: every member of `MILESTONE_STATUSES` and
  `OWNERS` appears in the rendered `planReviewPrompt` **and** `executeMilestonePrompt` output.
  This is the cheapest possible guard against the exact class of bug that made `blocked` a live
  status in the plan prompt and dead code in the handler.
- Plan prompt mentions the Owner column, `G<n>`, the gate categories, the per-gate
  `**Verification:**` shape, and the "Operator gates" section; it no longer contains the word
  `blocked`.
- Execute prompt mentions `needs_operator`, the no-push/no-PR/no-deploy rule and gate
  verification with its fallback ladder.
- `qaPrompt(ctx, [])` omits the coverage requirement; `qaPrompt(ctx, ["G1 — …"])` includes it.
- `chatPrompt(ctx, "need_operator")` carries the pause role description and the resume-marker
  guardrail.
- `LAP_BY_STAGE.need_operator === undefined` (in `tests/claude/skills.test.ts`).

**`tests/pipeline/handlers/qa.test.ts`** (extend) — `handleQa` passes the gate list through; a
malformed table produces `[]` plus a warning and **does not throw**.

---

## 9. M7 — Docs + housekeeping

### Goal

The documents this task made deliverables, so QA can judge them (PQ6). The cleanup lap normally
owns project documentation and `qaPrompt` tells QA not to report stale docs as a gap — so if these
land in cleanup, three acceptance criteria go unjudged. They land here instead, and the plan says
so explicitly.

### Code reuse

No source code changes. `vibe-racer new` (the shipped CLI, rebuilt in M5) creates the follow-up
tasks — no hand-written plan folders.

### Tasks

1. **`CLAUDE.md`** (AC20):
   - Replace the **"One questions file per stage"** key decision (line 43) with the
     `(file, markerText)` injectivity invariant: `STAGE_QUESTIONS_FILE` maps each human stage to a
     *pair*, and it is the **pair** that must stay unique. `need_execution` and `need_operator`
     share `04_execute.md` but never share a marker; pointing `need_operator` at a
     `Ready to advance` marker is the issue-#3 stale-tick regression in its new form, and
     `states.test.ts` fails if anyone does.
   - Add a key decision for **operator gates and the `need_operator` detour**: gates are declared
     at plan time as `Owner = operator` rows; the detour lives outside `STAGE_ORDER` and returns
     to `ready_to_execute`; the agent signals through `04_execute.md` and the handler writes the
     stage.
   - Update the **"Seven laps, seven documents"** entry: execution is one session per milestone
     against the Execution Status table, bounded by `MAX_STALLED_SESSIONS` and the per-`drive`
     session cap.
   - Add `execute-table.ts` and `operator-block.ts` to the project-structure block.

2. **`docs/how-it-works.md`** (AC21): rewrite the **"Execution Loop"** section — it is **already
   wrong today**, describing one session and checkboxes rather than one session per milestone
   against a status table. The new section covers: the table as the source of order, one session
   per milestone, the four ways execution stops (planned gate / agent-declared / stall / session
   backstop), the `need_operator` detour, the three ways out of a pause, and the known QA-scope
   limitation (QA is scoped to `git diff main...HEAD`, so work merged before a gate leaves the
   diff). State plainly that **the guard is unchanged by this task**.

3. **`CHANGELOG.md`**: one `## [Unreleased]` entry — Added (`need_operator`, operator gates, the
   pause block, the parser), Changed (`handleExecute` rewritten; `STAGE_QUESTIONS_FILE` now
   `(file, markerText)`; `blocked` removed from the status union and parsed as `needs_operator`),
   Fixed (the infinite loop; an unparseable table no longer advances to `ai_qa`; a `blocked` row
   no longer skips work). Note the `BASH_BLOCKLIST` count correction (S1) rather than rewriting
   0.1.0's history.

   **This overrides `02_design.md` §14**, which assigned the entry to the cleanup lap. The cleanup
   lap must not add a second entry for this task — say so in M7's Notes cell so the cleanup agent
   reads it.

   **Do not bump the version or cut a release** (PQ2.4). Releases are the cleanup lap's and the
   operator's business, and a mid-execution version bump would make M8's declaration describe a
   version that does not exist yet.

4. **Create the three follow-up tasks** with `vibe-racer new "<title>"` — **without `--desc`**.
   `--desc` pre-ticks "Ready to advance to Objective Review" (`new.ts:20`), so the operator's next
   `drive` would advance all three and offer paid objective-review laps alongside #5's QA lap.
   Write each `00_objective.md` by hand from the text below and leave its checkbox **unticked** —
   when to start a follow-up is the operator's decision:
   1. **"Guard enforces the no-push rule"** — a `ready_to_execute` deny list for `git push`,
      `gh pr create`, `gh pr merge`, `gh release`, `gh workflow run`. **The read-only allowances
      `git fetch`, `gh pr view`, `gh pr list` are a hard requirement**, called out in the
      objective, or gate verification breaks.
   2. **"QA scope survives mid-task merges"** — once pre-gate work is merged into `main`, it
      leaves `git diff main...HEAD` and QA reviews a fraction of the task.
   3. **"`drive` operates on the task branch"** (PQ5) — check out before the advancement pass;
      decide what happens with a dirty working tree and with two actionable tasks on different
      branches.

5. **Delete `plans/0005_infinite-loop-fix/execute_infinite_loop_bug.md`** (AC20) — **the last act
   of this milestone**, after confirming every design decision it carries is reflected in
   `02_design.md`, this plan, or the code.

### Test requirements

- Full suite green; no source changes, so no new tests.
- The `(file, markerText)` invariant test from M3 is the enforcement half of AC20 — confirm it is
  present and passing, and that `CLAUDE.md` now states the invariant it enforces.
- Confirm `execute_infinite_loop_bug.md` is gone and nothing references it (`grep -r` across the
  repo, excluding this task's own plan documents, which cite it as a historical input).

---

## 10. M8 — Security declaration review

### Goal

The declaration describes the code **as shipped**. Strictly last, strictly docs-only (AC22).

### Boundaries — these are the milestone's acceptance conditions

- **This milestone changes no code.** "Guardrails unchanged" is a constraint of this task, and a
  code change in the final milestone would invalidate it. The test is **no path under `src/`**,
  not an exact file list: `commitAll` runs `git add .` (`operations.ts:34`), so every milestone
  commit also carries `04_execute.md`, and often `state.yml` and `03_plan.md` — verified against
  real history (`167e6a4`, `10aa0aa`). The three documents this milestone *intends* to touch are
  `docs/security.md`, `SECURITY.md` and `README.md`.
- A finding that needs a code change is **recorded in Known Limitations as a fourth follow-up for
  the operator to create**. It does not get fixed here, and M8 does not run `vibe-racer new`
  either — that writes a new plan folder, which would break this milestone's own docs-only rule.
  (M7 creates follow-ups 1–3; M7 runs before M8, so a finding surfacing here has missed it.)
- `CHANGELOG.md` history is not rewritten (0.1.0 may keep saying 19); M7's entry notes the
  correction.

### Tasks

1. **Resolve the four known findings** (§12.3), item by item:

   | # | Finding | Files |
   |---|---|---|
   | **S1** | "19 commands" blocked — `BASH_BLOCKLIST` (`guard.ts:38-57`) has **18** entries, and the doc's own list has 18 | `docs/security.md`, `SECURITY.md`, `README.md` |
   | **S2** | "a multi-layered security system is enforced on every session" — **`radio` is not such a session.** It spawns the operator's own interactive `claude` CLI with a system prompt; `canUseTool`, Rule 0 and the path jail do not apply. Radio is absent from the declaration entirely | `docs/security.md`, `SECURITY.md` |
   | **S3** | Root `SECURITY.md` predates 0.3.0: it says review stages have no Bash (QA does), and omits Rule 0, `jailToPlanDir`, and the `settingSources` trust-boundary change | `SECURITY.md` |
   | **S4** | "vibe-racer never pushes" is a **prompt rule only** — the guard does not block `git push`, `gh pr create` or `gh pr merge`. Belongs under Known Limitations, **naming M7's follow-up #1** | `docs/security.md` |

2. **Add what this task itself contributes** (§12.4):
   - **`need_operator`**: a human stage; no agent session runs while paused. State is written by
     the handler only (Rule 0 unchanged).
   - **Gate verification deliberately uses the network** (`git fetch`, `gh pr view`) from inside an
     execute session. State how that sits next to the Docker `--network none` recommendation, and
     that the fallback ladder means a sandboxed operator can still pass a gate.
   - **Agent prose is written into a committed file** (the pause block). It is quoted inertly so a
     session cannot resume its own task through its final message, and it passes through the
     pre-commit secret scan like any other staged content.
   - **What an execute session can still do to the playbook**: it has `Edit` on `04_execute.md`, so
     the pause block it authors is **normalised by the handler, not trusted**.

3. **Check every remaining factual claim against the source** (§12.2) — `src/claude/guard.ts`,
   `src/claude/session.ts`, `src/cli/radio.ts`, `src/git/secrets.ts`, and each handler's
   `allowedTools` — and either confirm, correct, or remove it. **Claims are never softened to fit;
   if the code is weaker than the declaration, the declaration says so under Known Limitations.**

4. **Reconcile the three documents.** `docs/security.md` is the source of truth; root
   `SECURITY.md` ("Security Posture") and the README "Security" section must agree with it and
   with each other when this milestone is done.

### Test requirements

- Full suite green, build green, lint green — unchanged from M7, since no code moved.
- **`git status --short`, run before the pipeline commits, shows no path under `src/`.** That is
  the evidence for AC22's "changed no code" clause, and it goes in M8's Notes cell.
  **Not `git show --stat HEAD`.** The pipeline commits *after* the session returns
  (`execute.ts:38`), so while the M8 agent can observe anything, `HEAD` is still **M7's** commit —
  its own commit does not exist yet. `git diff --stat HEAD` works too; `git show` does not.

---

## 11. Dependency graph

```
        (pure, no callers)
  M1 ──────────────┬─────────────────────────┐
  execute-table.ts │                         │
                   │                         ▼
  M2 ──────────────┤                   M5 ──────► M6 ──────► M7 ──────► M8
  operator-block.ts│                 the loop    prompts    docs +    security
                   │                    ▲                 housekeep   (docs only)
                   ▼                    │
                  M3 ──────► M4 ────────┘
              state layer   drive/pitwall   (ordering, not compilation)
```

**Hard dependencies (a `tsc` failure if violated):**

| Milestone | Needs | Why |
|---|---|---|
| M3 | M1 | `resumeFromOperatorPause` calls `parseExecutionStatus` / `setMilestoneStatus`; the gate announcement calls `operatorGates` |
| M3 | M2 | `STAGE_QUESTIONS_FILE.need_operator.markerText` **is** `OPERATOR_RESUME_MARKER`; the resume path calls `findLastPauseBlock` / `readPauseBlockState` / `untickResumeMarker` |
| M4 | M3 | Reads `Task.operatorReason` / `operatorMilestone` and `StageQuestions.markerText` |
| M5 | M3 | `pauseForOperator` / `clearResumedAt` live in `store.ts`; `"need_operator"` is not a `Stage` until `schema.ts` grows it |
| M5 | M1, M2 | The parser, the mutator, the renderer |
| M6 | M1, M2 | Interpolates `EXECUTION_TABLE_SPEC` and `PAUSE_BLOCK_SPEC` |

**Soft dependencies (ordering, enforced by this plan and nothing else):**

| Milestone | Before | Why |
|---|---|---|
| M3's map entry | M3's delegation | **H1** — a split M3 is a permanent false `advanced: true`. One commit |
| M4 | M5 | A paused task landing before the CLI knows about pauses shows as a bare `[need_operator]` with no reason and no marker hint. Cost of the ordering: zero |
| M5 | M6 | Prompts must not instruct the agent to do something the pipeline cannot yet honour |
| M7 | M8 | M8 describes the code **as shipped** — it must be all of it |

M1 and M2 are mutually independent; M1 first only because M6's contract test and M5's driver both
lean harder on it.

---

## 12. Test strategy

### Shape

The decomposition exists so the tests that matter need no mocks (§13.1):

| Layer | Style | Mocks |
|---|---|---|
| `execute-table.ts` | pure unit + real-playbook fixtures | none |
| `operator-block.ts` | pure unit + adversarial round-trip | none |
| `decideNextStep` / `foldOutcome` | **table-driven**, one row per AC | none |
| `handleExecute` driver | integration | `runAndStream`, `git`, `fs` |
| `resumeFromOperatorPause` | integration on a temp dir | real `fs`, no SDK |
| `states.ts` invariant | pure | none |
| CLI surfaces | `vi.mock` of `discoverTasks` / config / git, per today's convention | yes |

**A test for AC1 must not need the SDK, git and the filesystem mocked at once** — that is the test
nobody maintains. Only a couple of driver tests stub `runAndStream`.

### Conventions this task follows, because the repo already does

- **Temp-dir integration** (`mkdtempSync` + real `fs`, torn down in `afterEach`) for anything that
  reads or writes `state.yml` or plan files — the shape of `tests/state/advancement.test.ts` and
  `tests/state/store.test.ts`.
- **Module-level `vi.mock`** with hoisted `vi.fn()` handles for handler and CLI tests — the shape
  of `tests/pipeline/handlers/execute.test.ts` and `tests/cli/pitwall.test.ts`.
- **Tests land in the same commit as the code they cover.** M5 is the single exception, where the
  AC1 test is written first because it *is* the acceptance criterion.

### Non-negotiables (§13.3)

1. **The AC1 test is written first** and its failure against the current `handleExecute` is
   **observed and recorded** in M5's Notes — with `commitAll` stubbed, or the evidence run leaves
   hundreds of junk commits on the task branch.
2. **No test depends on a live SDK session or the network.**
3. **Fixtures are copies of the real playbooks.** A parser that passes synthetic tables and fails
   `plans/0004`'s multi-paragraph Notes cells is a parser that breaks in-flight tasks. Tests never
   read `plans/` at run time — this very task mutates it.

### Per-milestone gate

Every milestone ends with all four green, and no milestone is committed otherwise:

```bash
npm run build && npm run typecheck && npm run test && npm run lint
```

**Coverage only goes up.** Baseline is 31 test files / 449 tests. A milestone that keeps the suite
green by deleting or skipping a test is not done — with one recorded exception: M5 deletes the four
cases in `tests/pipeline/handlers/execute.test.ts` that assert the regex-count behaviour being
removed, and replaces them with a strictly larger set.

---

## 13. Plan-level decisions that complete the design

Recorded so QA can tell a deliberate completion from a deviation.

**D1 — `currentBranch` lands in M4, not M5.** PQ1's table groups it with `repoSnapshot` under
`git/operations.ts`. Its only caller is M4's nothing-to-do branch hint, and a milestone that ships
a call site for a helper landing two milestones later does not end green. Split by call site.
`repoSnapshot` stays in M5 with its only caller.

**D2 — `parseExecutionStatus` takes an optional `file` argument**, defaulting to `"04_execute.md"`.
The design gives `parseExecutionStatus(content: string)` and separately requires that every error
message names the file (AC12 is a message-quality criterion). An optional second parameter
satisfies both without touching the module's purity, and lets the handler pass the plan-relative
path so the operator sees `plans/0005_infinite-loop-fix/04_execute.md`, not a bare filename.

**D3 — an unrecognised Owner value throws**, with the same message shape as an unrecognised
status. The design's throw list (§3.3) names status but is silent on owner. Silently defaulting a
typo'd owner to `agent` would hand a human-owned step back to the agent — the exact failure this
task exists to prevent — and defaulting is not covered by invariant I2 ("an unreadable table
throws; it never reads as nothing pending"). No backward-compatibility cost: playbooks without an
Owner column never reach this branch, and only the M6 prompt writes the column.

**D4 — `rowStatus(table, id)` is exported from `execute-table.ts`** (M1). The design's §6.3 driver
pseudocode calls it but §3.5 does not list it. It is a derived table query and belongs with the
other six, not reimplemented inside the handler.

**D5 — `validStage` is extracted in `store.ts` and reused in `drive.ts`.** The
`(STAGES as readonly string[]).includes(x)` test exists inline at `store.ts:21` and `drive.ts:138`;
`writeState`'s new `need_operator` branch would make three. Consolidate rather than accumulate.

**D6 — the driver uses absolute plan paths throughout**, replacing today's relative
`updateStage(ctx.planPath, …)` at `execute.ts:47`. The new store helpers require absolute
(§5.3) and two conventions in one function is how the `ENOENT` in D5's neighbourhood gets written.
The rewritten `execute.test.ts` asserts the absolute form.

**D7 — this task's own playbook gets no Owner column and no gate rows** (PQ2.5, hazard H3). Under
the old loop an `Owner = operator` row with status `pending` would spin forever — the bug being
fixed. The one operator-owned step this task has (the M5 cutover interrupt) is documented in M5's
Notes cell as a deliberate, skippable choice, and `04_execute.md`'s "Operator gates" section says
so explicitly.

---

## 14. Traceability: AC → milestone

| AC | Milestone | Proven by |
|---|---|---|
| 1 Reported case cannot recur | **M5** | `execute.test.ts`: 2 sessions then `need_operator`; evidence run in M5's Notes |
| 2 `needs_operator` → 1 session | M5 | table-driven `decideNextStep` |
| 3 Operator row → 0 sessions | M5 | `runAndStream` not called |
| 4 Progress resets stalls | M5 | table-driven `foldOutcome` |
| 5 Cap pauses, not errors | M5 | table-driven |
| 6 Overrule ⇒ threshold 1 | M3 (`resumed_at`) + M5 (`thresholdFor`) | table-driven + store test |
| 7 Resume in same invocation | M3 | `advancement.test.ts`, `drive.test.ts` |
| 8 Stale ticks do not resume | M2 | `operator-block.test.ts` (last block, fence-aware) |
| 9 Hand edits respected | M1 (no-op mutator) + M3 (status-guarded settle) | `advancement.test.ts` |
| 10 Re-pause wording | M2 (`isRepause`) + M5 (sets it) | `operator-block.test.ts` |
| 11 Legacy `blocked` pauses | M1 (alias) + M5 (cause) | `execute-table.test.ts` |
| 12 Unparseable table errors | M1 (`ExecutionTableError`) + M5 (throws in the driver) | message assertions |
| 13 No-Owner playbook runs | M1 (default) + M5 (`extraNotes` line) | fixtures + M5's dry read |
| 14 Gates listed at sign-off | M3 (`tryAdvance` log) + M6 (plan prompt section) | `advancement.test.ts`, `prompts.test.ts` |
| 15 `pitwall`/`drive` visibility | M4 | CLI tests, incl. "no error/failed wording" |
| 16 Block is self-sufficient | M2 (renderer defaults) | per-cause render tests |
| 17 Stall kind + inert quote | M2 (render) + M5 (`repoChanged`) | round-trip + driver tests |
| 18 `radio` at a pause | M3 (`isHumanStage`) + M6 (`chatPrompt`) | `prompts.test.ts`, `radio.test.ts` |
| 19 QA states coverage | M6 | `prompts.test.ts`, `qa.test.ts` |
| 20 `(file, marker)` invariant | M3 (test) + M7 (`CLAUDE.md`, deletion) | `states.test.ts` |
| 21 Guard unchanged | all — **no milestone touches `guard.ts`** | `git diff` + `how-it-works.md` (M7) |
| 22 Security declaration reviewed | **M8** | `git status --short` before the commit shows no path under `src/` |
