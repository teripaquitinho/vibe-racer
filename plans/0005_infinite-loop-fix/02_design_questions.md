# Design Questions for #5: infinite-loop-fix

> **Role**: Senior Software Architect
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-09-21

---

**Scope note.** The product decisions are settled in `01_product.md` and are not re-opened here.
These six questions pin the technical boundaries that everything else in the design hangs off:
where the table format is defined, how it is parsed, how pause blocks are read and written, how
`need_operator` enters the state layer, how the loop is structured so the bug is testable without
a live SDK, and where resume lives.

---

## Module structure and the format contract

### Q1: Where does the Execution Status table format live, and how do prompt and parser stay in sync?

The table format is about to be described in three places — the plan prompt (which tells the agent
to emit it), the execute prompt (which tells the agent to update it), and the parser (which reads
it). Today's bug is partly a drift bug: `blocked` exists in the plan prompt and means nothing to
the handler. If those three descriptions live in three string literals, the next drift is a matter
of time. Do we introduce a single source of truth for the contract, and if so what exactly does it
own?

**Answer:**
Yes — a new `src/pipeline/execute-table.ts` module that owns the **contract**, and prompts that
quote it rather than restate it.

The module exports:

- `MILESTONE_STATUSES = ["pending", "in_progress", "done", "needs_operator"] as const` and the
  `MilestoneStatus` type;
- `OWNERS = ["agent", "operator"] as const`;
- `GATE_ID_PATTERN = /^G\d+$/` and `MILESTONE_ID_PATTERN = /^M\d+$/`;
- `EXECUTION_STATUS_HEADING = "Execution Status"`;
- `EXECUTION_TABLE_SPEC` — the human-readable markdown block (header row, column meanings, the
  legal status values, the gate-row rule) that both `planReviewPrompt` and
  `executeMilestonePrompt` interpolate verbatim;
- the parser and mutator from Q2.

Rules that follow:

1. **Prompts never hand-write the column list or the status values.** They interpolate
   `EXECUTION_TABLE_SPEC` and the derived constants. A status added to the union appears in the
   prompt automatically.
2. **A contract test** asserts that every value in `MILESTONE_STATUSES` and `OWNERS` appears in
   the rendered plan prompt and execute prompt, and that a table parsed from the example inside
   `EXECUTION_TABLE_SPEC` round-trips through the parser. That is the cheapest possible guard
   against the exact class of drift that caused this bug.
3. `blocked` is **not** in the union. It lives only as a legacy alias inside the parser (Q2).
4. `src/pipeline/validation.ts` keeps its current job — generic answer/marker/checklist validation
   across all stages — and does **not** grow table knowledge. The bug spec proposed putting the
   parser there; splitting it out keeps `validation.ts` stage-agnostic and makes the new surface
   testable on its own.

---

### Q2: What is the parser's data model, and what exactly makes it throw?

`parseExecutionStatus` is the load-bearing piece: acceptance criteria 1, 3, 11 and 12 are all
statements about it. It has to be strict enough that an unreadable table errors rather than
reading as "nothing pending", and lenient enough that `plans/0001`–`0004` keep working. What does
it return, how does it locate the table, and where is the line between "tolerate" and "throw"?

**Answer:**
A pure function over a string, returning a structured table that keeps enough positional
information to write rows back.

```
parseExecutionStatus(content: string): ExecutionTable
  ExecutionTable = { rows: MilestoneRow[]; headerLineIndex: number; columns: ColumnMap }
  MilestoneRow = {
    id: string;              // "M9" | "G1" | whatever the operator wrote
    name: string;
    owner: "agent" | "operator";
    status: MilestoneStatus;
    commit?: string;
    notes?: string;
    lineIndex: number;       // absolute line in the file, for setMilestoneStatus
    legacyBlocked: boolean;  // this row said `blocked`
  }
```

**Locating the table:** scan for the first markdown heading whose text contains
`EXECUTION_STATUS_HEADING` (case-insensitive), then take the first pipe table after it, ending at
the first blank line or next heading. Nothing outside that table is ever read — this alone fixes
the "`pending` in the Milestone summary or in prose keeps the loop alive" bug (bug spec §2.4.3).

**Column resolution is by header name, not position** (`ColumnMap`), normalising with
trim + lowercase + backtick strip. Missing `Owner` column ⇒ every row defaults to `agent`
(backward compatibility, product §9.3). Missing `Commit`/`Notes` ⇒ `undefined`.

**Tolerate:** any case, surrounding backticks, bold (`**done**`), leading/trailing whitespace,
extra columns, absent alignment row, `—`/empty cells.

**Throw `ExecutionTableError` (which `withErrorHandling` turns into `error`) when:** no
"Execution Status" heading; no pipe table under it; no `Milestone` **or** no `Status` column; zero
data rows; or **any** row whose status is not in the union after normalisation. The error message
names the file, the offending line and value, and what was expected — AC12 is a message-quality
criterion, not just a control-flow one.

**Legacy `blocked`** normalises to `needs_operator` with `legacyBlocked: true`, so the handler can
add the "marked `blocked` by an earlier run" line (product §9.3) without the status union growing
a fifth member.

**Writing back:** `setMilestoneStatus(content, id, status): string` rewrites only the status cell
on that row's line, preserving the rest of the line byte-for-byte (including the operator's own
formatting). If the row is gone — the operator deleted it — it is a **no-op**, not an error: hand
edits must never break resume (product §6.5). All of this is string-in/string-out; the handler
owns the file I/O.

---

## The operator-facing file

### Q3: Who owns reading and writing pause blocks in `04_execute.md`, and how is the agent's message made inert?

Pause blocks are written by the handler, sometimes written by the agent, and read by the resume
path — three call sites for one format. They also embed untrusted agent prose that must never be
counted as a checklist item or a resume marker (product §5.5), which is a parsing problem with a
security-ish flavour: a session that emits `- [x] Operator actions complete — resume execution`
in its final message must not be able to resume its own task. Where does this logic live and how
does the inertness actually hold?

**Answer:**
A second new module, `src/pipeline/operator-block.ts`, owning the format end to end. Nothing else
in the codebase knows the block's shape.

Exports:

- `OPERATOR_RESUME_MARKER = "Operator actions complete — resume execution"` and
  `PAUSE_HEADING_PATTERN = /^## Operator actions — pause (\d+) \(([^)]+)\)/`;
- `renderPauseBlock(input: PauseBlockInput): string` — the single renderer for all five pause
  causes, so the guaranteed-minimum five elements (product §5.2) are structurally impossible to
  omit; `PauseBlockInput` carries `{ pauseNumber, rowId, why, items[], verification | null,
  agentMessage | null, extraNotes[] }` and the renderer fills the defaults ("None — the agent will
  simply retry", "The agent left no closing message…", the legacy-playbook line).
- `findLastPauseBlock(content): { number, rowId, startLine, endLine } | null`;
- `readPauseBlockState(content): { markerTicked: boolean; unchecked: {line, text}[] } | null` —
  scoped to the **last** block only, which is what makes AC8 true by construction;
- `untickResumeMarker(content): string`.

**Inertness has to be structural, not regex-based.** Two layers:

1. **Fence + indent.** The agent's message is rendered inside a fenced block with a
   `~~~` fence (so a message containing ``` cannot break out) and is additionally emitted as a
   blockquote, i.e. every line prefixed. A `- [ ]` inside it is therefore never at a position the
   checklist scanner accepts.
2. **The scanner is fence-aware, not just anchor-aware.** `readPauseBlockState` tracks fence
   state while walking the block and ignores everything inside a fence. It also skips any
   blockquoted line. `validateDecisionChecklist` in `validation.ts` — which deliberately matches
   indented items — is **not** reused for pause blocks; the scoped scanner replaces it here,
   because the two have opposite requirements about indentation.

Round-trip tests are mandatory: render a block whose `agentMessage` contains a ticked resume
marker, a `- [ ]` item, a `## Operator actions — pause 9 (M1)` heading and a stray `~~~`, then
assert `findLastPauseBlock` still finds the real block and `readPauseBlockState` reports the real
items only.

---

## State layer

### Q4: How does `need_operator` enter the schema, `writeState`, and the stage maps — and what breaks if we get the `(file, marker)` map wrong?

`need_operator` has to be a real stage in the Zod enum without entering `STAGE_ORDER`, has to make
`isHumanStage` true, and forces `STAGE_QUESTIONS_FILE` — currently a `Stage → filename` map whose
injectivity is a documented invariant — to carry a marker as well. `error` is the existing model
for an out-of-order stage. How closely do we follow it, and what is the shape of the new map?

**Answer:**
Follow `error` structurally, but keep the two concepts separate in the schema.

**`src/state/schema.ts`:** add `need_operator` to `STAGES` (placed adjacent to `ready_to_execute`
for readability — position is inert because it is excluded from `STAGE_ORDER`), plus three
optional fields: `paused_stage: z.enum(STAGES).optional()`, `operator_reason: z.string().optional()`,
`operator_milestone: z.string().optional()`. They are *not* folded into `error_stage`/
`error_message`: `pitwall` and `drive` must be able to tell a pause from a failure without
inspecting the stage string, and a task can legitimately error *while* it has stale pause fields.

**`src/pipeline/states.ts`:** `STAGE_ORDER` today is `STAGES.filter(s => s !== "error")`. That
filter becomes an explicit `NON_LINEAR_STAGES = new Set(["error", "need_operator"])`, so the next
detour stage is a one-line change and the intent is named. `isHumanStage` then returns true for
`need_operator` for free. `STAGE_NEXT_NAME` gets `need_operator: "Resume Execution"`.

**The `(file, marker)` map.** Change `STAGE_QUESTIONS_FILE` from `Stage → string` to
`Stage → { file: string; marker: RegExp; markerText: string }` — one map, not two parallel ones,
because two maps can disagree. `markerText` is what `drive` prints in its hint (product §7.2);
`marker` is what `hasCompletionMarker`/`removeCompletionMarker` match. Existing stages get the
`Ready to advance to …` marker; `need_operator` gets `OPERATOR_RESUME_MARKER` from Q3.

`hasCompletionMarker` and `removeCompletionMarker` currently hard-code the
`^-\s*\[x\]\s*Ready to advance\b` regex; they take the marker as an argument instead. This is the
mechanical part of the change most likely to be under-done — grep for every call site.

**The invariant test** asserts uniqueness of the `(file, markerText)` pair across all stages, not
of `file` alone, and is the test AC20 requires. It must fail if someone later points
`need_operator` at the `Ready to advance` marker — that is the issue-#3 stale-tick regression in
its new form.

**`src/state/store.ts`:** `writeState` grows a branch mirroring the `error` one —
for `need_operator`, `prev = next = paused_stage` (falling back to `ready_to_execute` when
absent). Add `pauseForOperator(planPath, { row, reason })` and `resumeFromOperator(planPath)`
helpers so that "which fields get cleared on resume" lives in exactly one place; a forgotten
`operator_reason` would otherwise haunt `pitwall` for the rest of the task's life.

---

## The execute loop

### Q5: How is `handleExecute` structured so the reported bug is testable without a live SDK session?

Acceptance criteria 1–6 are statements about a loop that currently interleaves parsing, session
execution, git commits and state writes in one `while (true)`. A test for AC1 ("a session that
changes nothing must pause, not loop") should not need to mock the Agent SDK, git and the
filesystem at once — and if it does, the test that proves the fix will be the test nobody
maintains. What is the decomposition?

**Answer:**
Split the loop into a **pure decision function** and a thin effectful driver.

```
// pure, no I/O, exhaustively testable
decideNextStep(state: LoopState): Step
  LoopState = { table: ExecutionTable; currentId: string | null; stalls: number;
                sessionsThisDrive: number; sessionCap: number; resumedAt: string | null }
  Step = { kind: "run", row }                    // start a session on this row
        | { kind: "pause", row, cause: PauseCause }
        | { kind: "complete" }                   // nothing unfinished → ai_qa
  PauseCause = "planned_gate" | "agent_declared" | "stall" | "session_cap" | "legacy_blocked"
```

`handleExecute` becomes: read file → parse → `decideNextStep` → perform the effect → re-read,
re-parse, fold the outcome into `LoopState` → repeat. Every acceptance criterion from 1 to 6 is
then a table-driven unit test over `decideNextStep` with zero mocks, and only a couple of
integration tests need `runAndStream` stubbed.

Three details worth fixing in the design rather than discovering in code:

1. **The stall threshold is a function of state, not a constant:** `thresholdFor(row, resumedAt)`
   returns 1 when `row.id === resumedAt` (the post-overrule rule, product §4.4) and
   `MAX_STALLED_SESSIONS = 2` otherwise. `resumedAt` is read from `operator_milestone` before the
   state is cleared on resume, and is passed into the handler through `TaskContext` rather than
   re-read from disk mid-loop.
2. **The session cap is computed once, at loop entry**, from the initial parse:
   `cap = pendingAgentRows × MAX_STALLED_SESSIONS + SLACK`. Computing it per iteration would let a
   growing table raise its own ceiling (product §4.5).
3. **"Made no changes" is a repository question, not a `commitAll` question** (product §5.4). The
   handler captures `git rev-parse HEAD` plus a dirty-tree check before and after the session;
   `commitAll` returning nothing is not evidence of a stall, because the agent may have committed
   for itself. This also kills the dishonest `agent already committed` log line.

`runAndStream`'s return value — the final message, currently discarded — is threaded into the
`pause` effect. That single thread is the difference between AC1 passing and passing *usefully*.

---

## Resume and CLI integration

### Q6: Does the `need_operator` resume path live inside `tryAdvance`, and how does `drive` continue execution in the same invocation?

`tryAdvance` today is one generic procedure: marker → `validateAnswers` → (`need_decision` only)
checklist → `nextStage`. `need_operator` shares almost none of it — no Q&A answers to validate, a
different marker, block-scoped checklist, a row mutation, and a destination that comes from
`paused_stage` rather than `nextStage`. And product §6.6 requires resume to flow into execution
within the same `drive` run. Branch inside `tryAdvance`, or split?

**Answer:**
Split the decision, share the entry point.

`tryAdvance` keeps its signature and stays the single call site `drive` uses, but delegates at the
top: `if (currentStage === "need_operator") return resumeFromOperatorPause(planPath, cwd)`. The
generic path is untouched — its `validateAnswers` call would be actively wrong on a playbook, and
bolting conditionals onto it is how that function becomes unreadable.

`resumeFromOperatorPause` lives in `src/state/advancement.ts` next to `tryAdvance` (same layer,
same concerns) and does, in order:

1. `findLastPauseBlock` → none ⇒ `{ advanced: false, reason: "no_marker" }` (defensive; a paused
   task always has one);
2. `readPauseBlockState` → marker unticked ⇒ `no_marker`; marker ticked with unticked items ⇒
   `untickResumeMarker`, log the outstanding items, return `incomplete_checklist` — matching
   `need_decision`'s existing feel and starting no session;
3. settle the paused row via `setMilestoneStatus`, **guarded by the current status**: operator
   gate still `pending`/`needs_operator` ⇒ `done`; agent row still `needs_operator` ⇒ `pending`;
   anything else (operator hand-edited it) ⇒ leave alone (product §6.5);
4. `resumeFromOperator(planPath)` → stage back to `paused_stage`, `operator_*` cleared, with
   `operator_milestone` returned so the handler can apply the post-overrule threshold (Q5).

**Same-invocation continuation falls out of `drive`'s existing shape.** `drive` already runs
`tryAdvance` over human-stage tasks *before* selecting an agent-stage task, and re-reads state
after advancing. A task resumed to `ready_to_execute` is therefore already eligible for selection
in that same pass — the requirement is satisfied by returning to an agent stage, not by new
plumbing. What does need adding: the `ineligibleMessage`/"waiting on human" branch in `drive.ts`
must special-case `need_operator` so it prints the operator wording, the reason and the real
marker text (product §7.2), and `--retry`'s filter (`stage === "error"`) must stay as-is so it
never picks up a paused task.

`pitwall` groups on `stage === "need_operator"` and reads `operator_reason`/`operator_milestone`
straight from state — no file parsing in the CLI layer, which is why §8.4 writes the reason into
`state.yml` in the first place.

---

# Complete

- [ ] Ready to advance to Design Review
