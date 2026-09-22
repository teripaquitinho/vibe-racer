# Execution Playbook — #5: infinite-loop-fix

> **Source of truth for progress.** The Execution Status table below is the order and the state.
> The implementation plan (`03_plan.md`) is the source of truth for *what each milestone contains*.
> Do not add scope.

---

## Execution order

Eight milestones, strictly sequential. The ordering rule is one sentence:
**everything that consumes `need_operator` lands before the only thing that produces it.**

```
M1 Table contract + parser        (pure, no callers)
M2 Pause-block format             (pure, no callers)
 └─> M3 State layer + resume path (needs M1 + M2 — will not compile without them)
      └─> M4 Operator surfaces    (drive / pitwall speak about a pause before one can exist)
           └─> M5 THE LOOP        (the only producer of need_operator — AC1 lands here)
                └─> M6 Prompts    (after the loop: never instruct what the pipeline cannot honour)
                     └─> M7 Docs + housekeeping
                          └─> M8 Security declaration review   (strictly last, DOCS ONLY)
```

**M3 before M5 is not negotiable, and half of it is enforced by `tsc`:** `pauseForOperator` lives
in `store.ts` and `"need_operator"` is not a `Stage` until `schema.ts` grows it, so landing M5
first is not a thing that can happen.

**The half `tsc` does not catch is inside M3.** Its `STAGE_QUESTIONS_FILE.need_operator` entry
(`states.ts`) and its `need_operator` delegation in `tryAdvance` (`advancement.ts`) look separable
and are not. Land the map entry without the delegation and every paused task takes the generic
path, passes `validateAnswers` vacuously, gets `null` from `nextStage("need_operator")`, and
`tryAdvance` returns `advanced: true` anyway — a false success on every `drive`, forever. The map
entry, the delegation and the null-next guard go in **one commit**. See `03_plan.md` §1 hazard H1.

---

## Step-by-Step Protocol

For each milestone, in order:

1. Take the **first unfinished row** in the Execution Status table. Do not skip, do not reorder.
2. Leave the row `pending` while you work on it. **This playbook uses `pending` and `done` only
   — never `in_progress`** (see the note under Execution Status; it is a live hazard, not style).
3. Read the milestone's section in `03_plan.md` — it carries the file paths, function signatures
   and data structures. Implement **all** of its numbered tasks, and nothing outside them.
4. Write the tests listed under that milestone's **Test requirements**. Tests land in the same
   commit as the code they cover — except M5, where the AC1 test is written **first** (see below).
5. Verify, all four, in this order:
   ```bash
   npm run build && npm run typecheck && npm run test && npm run lint
   ```
6. Fix anything that is not green. A milestone is not done until all four are.
7. Set that row's status to `done` and fill in the Notes cell with anything the next milestone or
   QA needs to know.
8. The pipeline commits the milestone.

---

## Rules

- **One milestone at a time.** Take the first unfinished row. No skipping, no reordering, no
  starting a later milestone because the current one is awkward.
- **Always commit.** Every milestone is its own commit, with a passing build and a green suite.
- **Follow the plan.** `03_plan.md` is the specification. If something in it does not work, adapt
  the implementation but keep the same goals — and record the deviation in the Notes cell.
- **Coverage only goes up.** Baseline is **31 test files / 449 tests, all green**. A milestone that
  keeps the suite green by deleting or skipping a test is not done. One recorded exception: M5
  deletes the four cases in `tests/pipeline/handlers/execute.test.ts` that assert the regex-count
  behaviour being removed, and replaces them with a strictly larger set.
- **`guard.ts` is not touched by any milestone.** "Guardrails unchanged" is a constraint of this
  task (AC21), not an oversight. A finding that needs a guard change becomes a follow-up.
- **M8 changes no code**, tested as **no path under `src/`** (AC22). Not an exact file list:
  `commitAll` runs `git add .`, so every milestone commit also carries this playbook, and often
  `state.yml` and `03_plan.md`.
- **No version bump, no release.** Releases are the cleanup lap's and the operator's business; a
  mid-execution bump would make M8's declaration describe a version that does not exist yet.
- **No new runtime dependencies.** Nothing is added to `package.json`.

---

## Operator gates in this plan

**None — execution runs start to finish without you.**

There is **one** operator-owned action, and it is deliberately *not* a gate row: the optional
live-cutover interrupt at M5, described in the next section. It stays out of the table because
this playbook is executed by the **old** loop, which counts `pending` rows and runs a session on
each one. An `Owner = operator` row in this table would make that loop spin on it forever —
literally the bug this task exists to fix. See `03_plan.md` §13 D7.

Everything else about operator gates in this task is machinery for **future** plans, written by
the new plan prompt that lands in M6.

---

## Operator interrupt at M5 — optional, skippable, and not an agent step

M5 replaces the loop that is running this very task. **Nothing changes at the moment it commits:**
`handleExecute` is a `while (true)` inside a Node process that imported the module at startup, and
the installed CLI runs `dist/`, not `src/`. Without an interrupt, M6–M8 go on being driven by the
old regex loop — the very bug this task removes — and the live exercise of the new loop never
happens.

| Step | Owner | Note |
|---|---|---|
| `npm run build` | **M5 agent** (last item in its task list) | Load-bearing: `vibe-racer` here is an `npm link`, so the build overwrites the exact bundle the running CLI was loaded from |
| Commit M5 | pipeline | The driver's own `commitAll` |
| **Ctrl-C** | **operator, at the terminal** | The agent session is a *child* of the `drive` process; it cannot interrupt its own parent. This step can never be an agent task |
| `git status`, discard partial M6 work | **operator** | Not optional — see below |
| `npm run build` | **operator** | The interrupted M6 session may already have rebuilt `dist/` from its partial work; rebuild from the clean tree so the bundle is M5's |
| `vibe-racer drive` | **operator** | New bundle, new loop, M6 onward |

**There is no quiet gap to interrupt in.** The old loop runs `commitAll` → `readFile` → build
prompt → `log.info("Executing milestone 6 …")` → `runAndStream` with nothing in between:
sub-second. So the Ctrl-C lands *inside* the M6 session, which may already have edited files. That
is why the discard step exists. State is safe either way — `ready_to_execute`, M6's row still
unfinished — but the **working tree** is not, and without the sweep the restarted loop runs M6 on
top of uncommitted partial M6 work. The cue to watch for is the `Executing milestone 6` line.

**The cutover is the expected path; missing it is survivable, not free.** M6–M8 can complete under
the old loop (the table is well-formed and none of them pause), but they then run with the old
loop's two live hazards: the execute prompt in force still tells the agent to set `in_progress`
(`prompts.ts:499`), which on M8 ends the task early (see the note under Execution Status), and any
stray pipe-delimited pending text in this file keeps the loop alive forever. If you do miss the
window, watch the run to the end: after M8 the next line must be "All milestones complete", not
another "Executing milestone …".

**The escape hatch is unchanged, for every milestone.** M1–M5 all run under the old, unbounded
loop. If one of them stalls, Ctrl-C leaves the task at `ready_to_execute` with the first unfinished
row intact — then `git status`, discard partial work, and `npm run build` before driving again,
because `state.yml` survives an interrupt and neither the working tree nor the linked `dist/`
bundle does.

---

## Execution Status

Status values **in this playbook**: `pending` and `done`, nothing else. Owner column deliberately
absent — see "Operator gates in this plan" above. (`blocked` is removed by this task.)

**Why no `in_progress` here, when the contract has it.** This file is read by the **old** loop,
whose termination check is `countPendingMilestones` — a regex that counts cells whose status is
pending (`execute.ts:12-14`) and does not match `in_progress`. So a session that sets the **last**
remaining `pending` row to `in_progress` and then ends without reaching `done` leaves the loop
reading `pending === 0`: it breaks, fires `updateStage(ai_qa)`, and the milestone is silently
skipped while the task announces "All milestones complete". The exposed row is **M8**. The cutover
is optional and skippable, so this file cannot assume the new loop will be the one reading it.
`in_progress` stays in `MILESTONE_STATUSES` for playbooks written by M6's prompt, where
`firstUnfinished` is `status !== "done"` and the distinction is free.

**The same regex scans this whole file, not just the table.** Any text anywhere in this playbook
that puts the word pending between two pipe characters — in prose, in a Notes cell, in pasted
test output — is counted as an unfinished milestone, and under the old loop the task then never
terminates after M8. Never write that shape outside the Status column. When pasting evidence into
a Notes cell (M5, M8), strip or reword any such text first.

| Milestone | Name | Status | Commit | Notes |
|---|---|---|---|---|
| M1 | Table contract + parser | `done` | | Under the heading, skip a table that resolves neither `Milestone` nor `Status` (plan D8, `two-tables.md` fixture). `pendingAgentRows` = unfinished agent rows, not only the not-started status (plan D9). New `trailingOperatorRows` (plan D11). **Shipped:** `src/pipeline/execute-table.ts` + all 12 exports, 7 fixtures under `tests/fixtures/playbooks/`, 36 tests in `tests/pipeline/execute-table.test.ts`. Suite 32 files / 485 tests green (baseline 31 / 449). **For M3/M5:** `ExecutionTableError.line` is **1-based** (human-facing, pairs with `file`) while `MilestoneRow.lineIndex` is **0-based** (it indexes `content.split("\n")`). `setMilestoneStatus` and `rowStatus` match IDs case-insensitively. `splitRowSpans` is the single cell-boundary routine — it honours `\|` escapes and backtick spans, and `setMilestoneStatus` writes through its spans so escapes survive byte-for-byte. **Trap for M6:** `EXECUTION_TABLE_SPEC` opens with `### The milestone status table`, not with its own name — a heading containing the status-heading text would be matched first by the parser and its worked example would stop round-tripping. Any prompt that wraps the spec in a heading must respect the same rule. |
| M2 | Pause-block format | `done` | | **Shipped:** `src/pipeline/operator-block.ts` with all 9 exports plus `PAUSE_HEADING_PATTERN` and the five types, 32 tests in `tests/pipeline/operator-block.test.ts`. Suite 33 files / 517 tests green (M1 left it at 32 / 485). **For M3/M4:** line convention follows M1 — `PauseBlockLocation.startLine`/`endLine` are 0-based and `endLine` is inclusive (they index `content.split("\n")`), while `PauseBlockState.unchecked[].line` is **1-based**, because `drive` prints it at a partial tick. `unchecked` **excludes** the resume marker, so the resume test is `markerTicked && unchecked.length === 0`. The marker is matched case-insensitively after trimming, and only at column 0 outside every fence and blockquote. **For M5:** `renderPauseBlock` returns markdown padded with one newline at each end (the `completionSection` idiom), so `content + renderPauseBlock(input)` is the whole append. `normalisePauseBlock` is a **no-op when the content carries no block at all** — the handler must append a rendered block before calling it, including in the `agent_declared` case where the agent wrote nothing. The renderer knows nothing about N, so `stallKind` renders the fixed AC17 wording on a `**What kind of stall:**` line and the session count has to be in the handler's `why` sentence. The block also carries the three ways out (AC16). **Trap for M6:** `PAUSE_BLOCK_SPEC`'s worked example is **fenced** — M1's `EXECUTION_TABLE_SPEC` trap in its pause-block form. Unfenced, any file quoting the spec grows a phantom block that `findLastPauseBlock` returns ahead of the real one. Keep the fence when interpolating. **Deviation, recorded:** `extractGateSection` ends a gate's section at the next heading of the same or higher level **or** at the next `G<n>` heading whatever its level — a `### G10` under a `## G1` is a sibling gate, not a subsection, and without the second rule G1 swallowed G10's items. |
| M3 | State layer + resume path | `done` | | Map entry + delegation + null-next guard landed in ONE commit (hazard H1); both mutation-checked — reverting the guard fails `returns no_next_stage instead of a false success`, dropping the delegation fails 8 resume tests. **Shipped:** `need_operator` in `STAGES` (17 now, `schema.test.ts` count updated) + 4 optional pause fields; `NON_LINEAR_STAGES` in `states.ts`; `STAGE_QUESTIONS_FILE` is now `(file, markerText)`; `validStage`/`pauseForOperator`/`resumeFromOperator`/`clearResumedAt` in `store.ts`; `operatorReason`/`operatorMilestone` on `Task`; `resumeFromOperatorPause` exported from `advancement.ts`. Suite 33 files / 563 tests green (M2 left it at 33 / 517). **For M4:** `Task` already carries the pause fields — `pitwall`/`drive` must not re-read `state.yml`. `STAGE_QUESTIONS_FILE[stage]?.markerText` is the resume hint text; `STAGE_NEXT_NAME.need_operator` is deliberately `undefined`, so drive's existing `nextName ? … : "the checkbox"` fallback fires for a pause and M4 must replace it, not extend it. **For M5:** `pauseForOperator(path.join(ctx.cwd, ctx.planPath), …)` — the three store helpers take an ABSOLUTE plan path. `resumeFromOperator` returns `{ pausedStage, milestone }` and writes `resumed_at`; `clearResumedAt` is M5's to call. `settleRow` only rewrites the two statuses the pipeline itself wrote, so a hand edit survives resume. **Deviations, recorded:** (1) `AdvancementResult.reason` grew by FOUR, not three — D11's blocking check needs `trailing_operator_rows`, which the plan describes but omits from the §7.1 union. (2) `drive.ts` also took the `validStage` consolidation from plan §5.3 (its `STAGES.includes` retry check was the third copy); `tests/cli/drive.test.ts` mocks `store.js`, so its factory now passes `validStage` through from `importOriginal`. (3) The store test for an INVALID `paused_stage` asserts the schema rejects it instead of asserting the `?? "ready_to_execute"` fallback — zod rejects the value on both read and write, so that fallback is a floor and is unreachable through the public API. (4) The null-next guard is unreachable through the public API today (no stage in `STAGE_ORDER` lacks a next, and the only one outside it is delegated away), so `advancement.test.ts` mocks `nextStage` via `vi.hoisted` for that one test. |
| M4 | Operator surfaces | `done` | | `currentBranch` landed here, not M5 (plan D1). **Shipped:** `currentBranch(git)` in `src/git/operations.ts` (next to `getVibeRacerBranches`, never throws — its only caller is a cosmetic tail line); drive's operator group + `branchHint` + `operatorFile`/`pauseSummary`; pitwall's operator group + `pausedAt`/`playbookPath`. Suite 33 files / 577 tests green (M3 left it at 33 / 563). **For M5:** neither CLI parses a plan file — both render from `Task.operatorMilestone` / `Task.operatorReason`, so `pauseForOperator` must always pass BOTH or the pit-board line degrades to `— paused` with no reason. Discovery's `Task.planPath` is ABSOLUTE and both CLIs print `path.relative(cwd, planPath)`, so a pause recorded with a repo-relative path renders as `../../…`. `tests/cli/drive.test.ts` mocks `src/git/operations.js` by factory — M5's `repoSnapshot` must be added to that mock or drive's tests fail on an undefined import. **Deviations, recorded:** (1) `ineligibleMessage` now takes the full `Task`, not `{number, stage}` — it needs `planPath` to name the playbook. (2) The pitwall operator group sits directly above the human group (below `Waiting on agent:`), the literal reading of "above the ordinary pit-stop group". (3) M4 task 4 (`radio`) needed no work: M3 already landed `accepts a need_operator task as eligible` in `tests/cli/radio.test.ts`. |
| M5 | The loop | `done` | | **Shipped:** `repoSnapshot` in `src/git/operations.ts`; `src/pipeline/handlers/execute.ts` rewritten around `decideNextStep`/`foldOutcome`/`thresholdFor`/`sessionCap` + a thin driver and `pause()`; `countPendingMilestones`, the `milestone++` counter and the `agent already committed` line are gone, no shim. 31 tests in the rewritten `tests/pipeline/handlers/execute.test.ts` (19 pure, 12 driver) + 3 for `repoSnapshot`. Suite 33 files / 607 tests green (M4 left it at 33 / 577). **AC1 evidence (task 2)** — the AC1 test run against the OLD handler on a scratch file, `runAndStream` AND `commitAll` stubbed, the `runAndStream` stub throwing after 50 calls: `FAIL tests/pipeline/handlers/evidence-old-loop.test.ts > handleExecute — AC1` / `Error: old loop: 50 sessions on an unchanged table` / `❯ handleExecute src/pipeline/handlers/execute.ts:29:11`, 5ms. The table was byte-identical throughout — the old loop re-read it, counted one unfinished row and opened another session, 50 times, and would not have stopped. Scratch file deleted, nothing committed. The same fixture against the new loop is the committed AC1 case: two sessions, then `need_operator` with the agent's final message inside the pause block. **Dry read (task 15), new parser, read in place:** this playbook → no Owner column, 8 rows, all `agent`, first unfinished M5, cap 10 — the table as written. `plans/0002` 3 rows, `plans/0003` 2 rows, `plans/0004` 7 rows (M5a/M5b included) — all finished, cap 2, no error. Consumer `bcb-time-tracker` `plans/0001_backend-scaffold/04_execute.md` (hand-written, section-numbered heading, no Owner column, a non-numeric `QA` row ID) → 9 rows, all agent, all finished, no error. No D8 finding; the throw was never loosened. **For M6:** `EXECUTION_TABLE_SPEC` and `PAUSE_BLOCK_SPEC` are unreferenced by any prompt until M6 wires them; the execute prompt still tells the agent to set `in_progress` (`prompts.ts` ~499), which this loop treats as an unfinished row — correct, but the whole `needs_operator` protocol is still missing from it. The handler reads a gate's checklist from `03_plan.md` via `extractGateSection`, so M6's plan prompt must keep writing a `G<n>` heading per gate row. **Deviations, recorded:** (1) vitest 4 removed `it(name, fn, opts)` — the AC1 timeout is `it(name, { timeout: 5_000 }, fn)`. (2) `repoSnapshot` also got 3 direct tests in `tests/git/operations.test.ts`, which the plan's test requirements do not list: the driver tests only ever see it stubbed, so sorting, de-duplication, the `ignorePrefix` filter and the unborn-branch path would otherwise ship untested. (3) `pause()` lifts the agent's `**Why paused:**` line with a local regex to fill `operator_reason`; `operator-block.ts` exports no reader for it and M2 is closed. (4) `vi.clearAllMocks` keeps implementations, so the driver tests re-apply the `pauseForOperator` fake in `beforeEach` — without it one test's override silently disarms the state assertions in the next. **Cutover:** `npm run build` ran last, so `dist/` (the `npm link` bundle) is now M5's. The operator interrupt is optional — see "Operator interrupt at M5"; the cue is the `Executing milestone 6` line from the OLD loop, and a Ctrl-C there needs a `git status` sweep before the next `drive`. |
| M6 | Prompts | `pending` | | Contract test lands here. Plan prompt must forbid merge / tag / release / deploy rows and require every gate row to be followed by the milestone it unblocks (plan D11) |
| M7 | Docs + housekeeping | `pending` | | CHANGELOG entry belongs to THIS task, not the cleanup lap — cleanup must not add a second entry. Follow-ups: `vibe-racer new` WITHOUT `--desc` (it pre-ticks the objective and the next `drive` would start a paid lap on them). `how-it-works.md` gains "Upgrading a playbook that predates operator gates" (plan D10) |
| M8 | Security declaration review | `pending` | | DOCS ONLY. Paste `git status --short` (run **before** the commit) here as AC22 evidence — no path under `src/` |

---

## Milestone Summary

### M1 — Table contract + parser

| Item | Detail |
|---|---|
| New files | `src/pipeline/execute-table.ts`, `tests/pipeline/execute-table.test.ts`, `tests/fixtures/playbooks/` (7 fixtures) |
| Modified files | none |
| Key exports | `parseExecutionStatus`, `setMilestoneStatus`, `firstUnfinished`, `rowStatus`, `operatorGates`, `pendingAgentRows`, `doneCount`, `hasOwnerColumn`, `ExecutionTableError`, `MILESTONE_STATUSES`, `OWNERS`, `EXECUTION_TABLE_SPEC` |
| Fixtures | Real `## Execution Status` sections from `plans/0002`, `0003`, `0004` — copied, never read live — plus `no-heading`, `unknown-status`, `legacy-blocked`, `pending-in-summary-only`. The last is full-file shaped and must also carry **prose between the heading and the table**, which is this playbook's own shape |
| Validation | Parses all three real tables incl. `plans/0004`'s `M5a`/`M5b` IDs and prose Notes; every throw asserts its message text; `EXECUTION_TABLE_SPEC`'s example round-trips |
| Commit message | `vibe-racer: M1 for #5` |

### M2 — Pause-block format

| Item | Detail |
|---|---|
| New files | `src/pipeline/operator-block.ts`, `tests/pipeline/operator-block.test.ts` |
| Modified files | none |
| Key exports | `OPERATOR_RESUME_MARKER`, `PAUSE_BLOCK_SPEC`, `renderPauseBlock`, `findLastPauseBlock`, `readPauseBlockState`, `untickResumeMarker`, `normalisePauseBlock`, `nextPauseNumber`, `extractGateSection` |
| Validation | **The adversarial round-trip is mandatory** — a rendered block whose agent message contains a ticked marker, a `- [ ]`, a pause heading and a stray fence must still read as unticked with the real items only |
| Do NOT | Reuse `validateDecisionChecklist` — it matches indented items on purpose; this scanner must not. Leave `validation.ts` untouched |
| Commit message | `vibe-racer: M2 for #5` |

### M3 — State layer + resume path

| Item | Detail |
|---|---|
| New files | none |
| Modified files | `src/state/schema.ts`, `src/pipeline/states.ts`, `src/state/store.ts`, `src/state/discovery.ts`, `src/state/advancement.ts`, `src/cli/drive.ts` (call-site fix only), + `states.test.ts`, `store.test.ts`, `advancement.test.ts`, `radio.test.ts` |
| Key exports | `pauseForOperator`, `resumeFromOperator`, `clearResumedAt`, `validStage`, `StageQuestions`, `resumeFromOperatorPause` |
| One commit | The `STAGE_QUESTIONS_FILE` map entry, the `tryAdvance` delegation and the null-next guard (H1) |
| Three call sites | `advancement.ts:24`, `drive.ts:100-101`, `states.test.ts:95-103` — all switch to `?.file` |
| Path convention | The three store helpers take an **absolute** plan path. `tryAdvance` runs in `drive`'s un-wrapped loop, so a wrong path takes down `drive` for every task |
| Validation | `(file, markerText)` injectivity test (AC20); resume respects hand edits; an unparseable table at resume returns rather than throws; generic path returns `advanced: false` when there is no next stage |
| Commit message | `vibe-racer: M3 for #5` |

### M4 — Operator surfaces

| Item | Detail |
|---|---|
| New files | none |
| Modified files | `src/git/operations.ts`, `src/cli/drive.ts`, `src/cli/pitwall.ts`, + `drive.test.ts`, `pitwall.test.ts` |
| Key export | `currentBranch(git)` |
| Validation | Paused tasks render under "Waiting on operator" once, with milestone, reason and file; the hint names the real resume marker; neither "error" nor "failed" appears; `--retry` does not select them; `radio` accepts a paused task |
| Watch for | `pitwall`'s `humanTasks` must now **exclude** `need_operator`, and its empty-state check must count paused tasks |
| Commit message | `vibe-racer: M4 for #5` |

### M5 — The loop

| Item | Detail |
|---|---|
| New files | none |
| Modified files | `src/pipeline/handlers/execute.ts` (rewritten), `src/git/operations.ts`, `tests/pipeline/handlers/execute.test.ts` (rewritten) |
| Key exports | `decideNextStep`, `foldOutcome`, `thresholdFor`, `sessionCap`, `MAX_STALLED_SESSIONS`, `SESSION_CAP_SLACK`, `repoSnapshot` |
| Deleted | `countPendingMilestones`, the `milestone++` counter, the `agent already committed` log line. No shim |
| Order within the milestone | 1. AC1 test. 2. Evidence run against the OLD handler — before rewriting it, nothing committed — stubbing `runAndStream` **and** `commitAll`, with the `runAndStream` stub **throwing after 50 calls** (a timeout cannot fire: see `03_plan.md` M5 task 2), output pasted into the Notes cell. 3. `repoSnapshot`. 4. Rewrite. 5. Suite green. 6. Dry read of this file with the new parser. 7. `npm run build` |
| Validation | `runAndStream` called **exactly twice** on an unchanged table, then `stage: need_operator` with the agent's final message in this file; never called for a planned gate; an unparsable table throws and `ai_qa` is never written |
| Commit message | `vibe-racer: M5 for #5` |

### M6 — Prompts

| Item | Detail |
|---|---|
| New files | none |
| Modified files | `src/claude/prompts.ts`, `src/pipeline/handlers/qa.ts`, + `prompts.test.ts`, `qa.test.ts`, `skills.test.ts` |
| Changes | `planReviewPrompt` interpolates `EXECUTION_TABLE_SPEC`; `executeMilestonePrompt` gains the `needs_operator` protocol, the no-push rule and gate verification; `qaPrompt(ctx, gates)`; `chatPrompt` learns `need_operator` |
| Deleted | The hand-written status list containing `blocked` in `planReviewPrompt` |
| Validation | **Contract test** — every `MILESTONE_STATUSES` and `OWNERS` member appears in both rendered prompts; the plan prompt no longer contains the word `blocked`; a malformed table in `handleQa` yields `[]` plus a warning and does not throw |
| Commit message | `vibe-racer: M6 for #5` |

### M7 — Docs + housekeeping

| Item | Detail |
|---|---|
| New files | three follow-up task folders, created with `vibe-racer new "<title>"` — **no `--desc`**; write each `00_objective.md` by hand and leave its checkbox **unticked** |
| Modified files | `CLAUDE.md`, `docs/how-it-works.md`, `CHANGELOG.md` |
| Deleted files | `plans/0005_infinite-loop-fix/execute_infinite_loop_bug.md` — the **last** act of this milestone |
| Follow-ups | 1. Guard enforces the no-push rule (`git fetch` / `gh pr view` / `gh pr list` must stay allowed). 2. QA scope survives mid-task merges. 3. `drive` operates on the task branch |
| Validation | Suite green; `CLAUDE.md` states the `(file, marker)` invariant that `states.test.ts` enforces; nothing outside this task's own plan documents references the deleted file |
| Commit message | `vibe-racer: M7 for #5` |

### M8 — Security declaration review

| Item | Detail |
|---|---|
| New files | none |
| Modified files | `docs/security.md`, `SECURITY.md`, `README.md` — **and nothing under `src/`**. The pipeline's `git add .` will also sweep in this playbook; that is expected, not a violation |
| Findings to resolve | S1 (18 blocked commands, not 19) · S2 (`radio` is not a guarded session and is absent from the declaration) · S3 (root `SECURITY.md` predates 0.3.0) · S4 (no-push is prompt-only → Known Limitations, naming follow-up 1) |
| Additions | `need_operator` as a human stage · gate verification uses the network vs the `--network none` recommendation · agent prose is committed but quoted inertly and secret-scanned · the execute session's `Edit` on this file is normalised, not trusted |
| Boundary | Docs only. A finding needing a code change is **recorded in Known Limitations as a fourth follow-up for the operator to create** — M8 cannot run `vibe-racer new`, which would write a new plan folder and break its own docs-only rule |
| Validation | `git status --short`, run **before** the pipeline commits, shows no path under `src/` — pasted into the Notes cell as AC22 evidence. **Not `git show --stat HEAD`**: the pipeline commits after the session returns, so `HEAD` is still M7's commit while the agent can observe it |
| Commit message | `vibe-racer: M8 for #5` |

---

## Stack / Technology Reference

| Tool | Command | Purpose |
|------|---------|---------|
| tsup | `npm run build` | Production build → `dist/` (also the cutover step at M5) |
| TypeScript | `npm run typecheck` | Type checking (`tsc --noEmit`) |
| Vitest | `npm run test` | Unit tests — baseline 31 files / 449 tests |
| ESLint | `npm run lint` | Linting (`eslint src/`) |
| tsx | `npm run dev` | Run the CLI from source, no build |

| Dependency | Used by this task | New? |
|---|---|---|
| `zod` | `stateSchema` gains four optional fields | no |
| `yaml` | `state.yml` read/write | no |
| `simple-git` | `repoSnapshot`, `currentBranch` | new calls on the existing client |
| `@anthropic-ai/claude-agent-sdk` | `runAndStream` — return value now consumed | no |
| `commander`, `chalk`, `ora` | CLI output for the operator group | no |
| `vitest` (dev) | two new test files, seven new fixtures | no |

**No new runtime dependencies.** Nothing is added to `package.json`.

---

# Complete

- [x] Ready to advance to Execution
