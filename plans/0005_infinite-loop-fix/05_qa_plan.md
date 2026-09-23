# QA Fix Plan — #5: infinite-loop-fix

> **Role**: Senior Software Engineer
> **Stage**: `fine_tuning` (input: `05_qa.md`, verdict *pass with six issues*)
> **Date**: 2026-09-23 · **Decisions taken**: 2026-09-23 (§5)
> **Branch at time of writing**: `vibe-racer/0005_infinite-loop-fix` @ `c76538d`
> **Scope**: what to do about the six issues and nine risks in `05_qa.md` — each fix sized by
> risk and effort, with an explicit "do not fix" list.

Citations: **I n** = `05_qa.md` §2 issue · **R n** = `05_qa.md` §5 risk · file:line refers to the
branch as it stands.

**Status — both batches implemented 2026-09-23.**

- **Batch A** (F2, F3, F4a, F5, F6, F8, F9) — committed as `1951a09`. Three pre-existing tests
  changed as §6 predicted, one of them — `GATE_ID_PATTERN` — keeping the half that mattered. The
  two F2 tests were mutation-checked: both fail with the snapshot order put back.
- **Batch B** (F1, F4b, F7) — implemented on this branch rather than as task #9, at the operator's
  instruction. `build`, `typecheck`, `lint` and `test` pass at **34 files / 662 tests** (baseline
  635). It has not had the QA lap §2 argued for; that call is the operator's.

Two deviations from this plan, both deliberate:

1. **F3 was narrowed.** The plan had `drive` warn on every non-advancing reason but
   `incomplete_checklist`. Wrong: `no_marker` is the everyday state of a pause in progress, so
   that would fire on every `drive` for every paused task. The fence diagnosis went into
   `advancement.ts`, which has the content in hand and can tell "hidden block" from "not ticked
   yet"; `drive` warns only for `no_questions_file`. A test pins the silence.
2. **F4b did not restore the heading.** The plan said fencing would let the worked example carry
   its `## Execution Status` heading again. It ships fenced *and* headingless: fenced-and-headed
   is safe only until an agent copies the example and drops the fence markers, which is exactly
   the reformatting agents do. Two independent defences cost nothing here.

One correction to §6: the fixture equivalence check cannot run against `main` — `main` predates
`execute-table.ts`, which this task created. The baseline is `1951a09` (batch A, pre-F1), against
which all four real playbooks — `0002`, `0003`, `0004` and this task's own — parse to identical
rows, header line and line indices. The `fenced-decoy.md` fixture was checked the other way round:
the pre-F1 parser reads it as `M1, G1, M2` and pauses at a gate that does not exist, the new one
reads `R1, R2`.

---

## 0. Does the report resonate? — independent verification

I re-ran the two claims the report rests on rather than taking the probe output on trust. Both
reproduce. The rest I confirmed by reading the code at the cited lines.

| Claim | Verdict | How I checked |
|---|---|---|
| I1 — parser is fence-blind; a fenced example table wins over the real one | **Confirmed, reproduced** | Fresh probe: a fenced spec example above a real table parses as `M1, G1, M2` and `firstUnfinished → G1`. The real row `R1` is never seen. `parseExecutionStatus` (`src/pipeline/execute-table.ts:279-286`) scans `HEADING_RE` with no fence state; `operator-block.ts:117-137` tracks fences for the same file |
| I1 — the prompts ship an unfenced `## Execution Status` | **Confirmed** | `EXECUTION_TABLE_SPEC` (`execute-table.ts:452-485`) ends with a *worked example* whose heading is unfenced; it is interpolated into both prompts (`prompts.ts:428`, `:553`) |
| I2 — `repoChanged` is decided by the driver's own commit | **Confirmed** | `execute.ts:480` `before` → `:492` `commitAll` (`git add .`) → `:493` `after`. `repoChanged` returns true on `before.head !== after.head` (`:304-308`). `dirtyFiles` is always empty after a successful `commitAll`, so the `ignorePrefix` exclusion cannot bite |
| I3 — an unclosed fence hides the pause block, resume fails silently | **Confirmed, reproduced** | Fresh probe: same file, `findLastPauseBlock` → `found`; with a stray ```` ```` ```` fence closed by ``` ``` ``` above it → `null`, `readPauseBlockState` → `null`. `drive.ts:105-115` logs only on `advanced: true` |
| I4 — the agent's final message is dropped on the reuse path | **Confirmed** | `execute.ts:382` `let next = reuse ? content : content + renderPauseBlock(input)` — on reuse `input.agentMessage` is never consumed |
| I5 — trailing-row check is status-blind at sign-off, status-filtered in the loop | **Confirmed** | `advancement.ts:125` (no filter) vs `execute.ts:312` (`status !== "done"`) |
| I6 — `resumed_at` survives a gate resume | **Confirmed** | `clearResumedAt` has exactly one call site, `execute.ts:521`, inside the run branch. A gate row is settled by `settleRow` (`advancement.ts:226-239`) and never runs |
| R4 — a secret in the agent's prose strands the pause with a dirty tree | **Confirmed by reading** | `withErrorHandling` rethrows `SecretDetectedError` before `setError` (`handlers/safe-wrapper.ts:24`); the pause's `commitAll` is at `execute.ts:393`, after `state.yml` is already `need_operator` at `:391` |
| §4 — `GATE_ID_PATTERN` is a dead export | **Confirmed** | `rg GATE_ID_PATTERN src` → `execute-table.ts:22` only |
| §4 — `**Why paused:**` has two homes | **Confirmed** | `operator-block.ts:27` `WHY_LABEL` and `execute.ts:215` `WHY_LINE` |

### Three findings the report does not have, which set the plan below

**A. The decoy is not drift — it is asserted by the suite.** `execute-table.test.ts:488-497`:

```js
it("its worked example round-trips through parseExecutionStatus", () => {
  const parsed = parseExecutionStatus(EXECUTION_TABLE_SPEC);
  expect(firstUnfinished(parsed)!.id).toBe("G1");
```

The spec's worked example is *required by test* to parse as a live table, and `prompts.test.ts:300`
requires it to reach both prompts verbatim. Two consequences: (i) any fix here reverses a codified
design statement, not an oversight; (ii) **fencing the example while the parser is fence-blind
protects nothing** — a fenced table still parses. Fencing is only protection *after* F1. What does
work without a parser change is removing the `##` from the example (F4a below).

**B. The pause cause is not machine-readable.** `PauseBlockState` is `{ markerTicked, unchecked }`
(`operator-block.ts:93-97`); the cause survives only as prose in the `**Why paused:**` line, plus a
`**Stall:**` label for stalls. So "treat a session-cap resume differently" (F9) means adding a cause
channel to the block or to `state.yml` — a contract widening, not a conditional. This is why F9 is
sized M, and why it was decided as a docs fix.

**C. No real playbook carries a decoy today.** All four of `0002`/`0003`/`0004`/`0005` contain
exactly one `Execution Status` heading. The trap is latent, not active — which is what makes
deferring the parser work (F1) to its own task defensible.

### Two corrections to the report's severities

**I1 is worse than "medium".** `setMilestoneStatus` re-parses through `parseExecutionStatus`
(`execute-table.ts:377`). So the pipeline does not merely *read* the decoy table — it **writes
status cells into a fenced code block inside the operator's playbook**, corrupting the very example
the agent was told to follow.

**I4 is weaker than stated.** The reuse path exists because the agent wrote its own block, and
`pausePartsFor` lifts that block's `**Why paused:**` line into the pause. What is lost is the
session's *trailing* narration, usually a restatement.

Verdict: **the report resonates.** No finding is invented, no severity is wrong by more than one
notch, and the "no regressions / 635 green" section matches a clean run.

---

## 1. The fix register

Effort is in engineer-sessions of the size this pipeline runs (one milestone = one session).
Risk is *blast radius if the fix is wrong*, not probability.

| # | Fix | Source | Effort | Risk | Batch |
|---|---|---|---|---|---|
| **F2** | Take the `after` snapshot before `commitAll` | I2, R2 | **XS** | **Low** | **A** |
| **F3** | `drive` says something when a `need_operator` task will not resume | I3, R1 | **S** | **Low** | **A** |
| **F4a** | Remove the `##` heading from the spec's worked example | I1 | **XS** | **Low** | **A** |
| **F5** | Clear `resumed_at` when a gate settles | I6 | **XS** | **Low** | **A** |
| **F6** | Document why the two trailing-row filters differ — no behaviour change | I5 | **XS** | **Nil** | **A** |
| **F8** | Housekeeping: delete `GATE_ID_PATTERN`, give `**Why paused:**` one home | §4 | **XS** | **Nil** | **A** |
| **F9** | Document the cap-resume threshold in `how-it-works.md` | R3 | **XS** | **Nil** | **A** |
| **F1** | One fence-aware markdown scanner, shared by the parser and the block reader | I1, R1 | **M** (1–2 sessions) | **Med** | **B (#9)** |
| **F4b** | Fence the worked example, now that fences mean something | I1 | **XS** | **Low** | **B (#9)** |
| **F7** | Survive a secret detected in the agent's pause prose | R4 | **S** | **Med** | **B (#9)** |
| **F10** | Keep the session's final message on the reuse path | I4 | **M** | **Low** | **Backlog** |

---

## 2. Sequencing

**Batch A — `fine_tuning`, this task, one session.** F2, F3, F4a, F5, F6, F8, F9. Seven changes,
none touching the parser or the block format; three of them are comments or docs. Together: ~7
files, ~8 new tests, two existing tests rewritten (§6). This is the batch that makes the pause
block tell the operator the truth, and it takes the prompts' hijack out of circulation for every
playbook written from here on.

**Batch B — task #9, "one markdown reader".** F1 + F4b + F7. F1 changes the contract of the file
every playbook is read through; it deserves an objective, a fixture sweep across
`0002`/`0003`/`0004` and its own QA lap rather than a fine-tuning slot. F4b rides with it because
fencing is inert until the parser honours fences. F7 joins because it is the other "the pipeline
leaves the operator worse off than before" failure, and because it is best reviewed alongside M8's
security declaration.

**Backlog.** F10.

**Why this split and not one pass.** The only cost of deferring F1 is the window between #5 merging
and #9 landing, in which a playbook could quote the spec into itself and hijack the loop. F4a
closes that window for every *new* playbook without touching the parser, and finding C says no
existing playbook is exposed. That leaves the parser hardening free to take the QA lap it deserves.

Dependency: none of Batch A depends on Batch B.

---

## 3. The fixes

### 3.1 F2 — snapshot before the commit · effort XS · risk Low · Batch A

**Problem.** `execute.ts:492-493` takes the `after` snapshot after `commitAll`, which runs
`git add .`. Any agent edit — including the Notes cell the playbook protocol *tells* it to write —
moves `HEAD` and reads as `repoChanged: true`, so the block says "The agent committed work but did
not finish this milestone… usually an oversized milestone; review the commits, then resume or
split the milestone" for what is exactly the reported case: an undeclared human step. The operator
is steered to split a milestone that does not need splitting.

**Fix.** Move `const after = await repoSnapshot(git, ctx.planPath)` to before the `commitAll` call.
The agent's *own* commits still move `HEAD` during the session, so `before.head !== after.head`
keeps its meaning; uncommitted non-plan work is now visible in `dirtyFiles`, which is what the
design intended and what the `ignorePrefix` argument was for. The `log.dim("no pipeline commit
(agent committed its own)")` branch at `:498` reads the same snapshots and stays correct.

**Files.** `src/pipeline/handlers/execute.ts` (two lines).

**Tests.** The existing AC17 driver tests stub `repoSnapshot` with hand-picked heads
(`execute.test.ts:514-541`) and so are blind to the ordering — that is why this survived. Add one
test that stubs `repoSnapshot` *by call order* and a `commitAll` that moves the head, asserting the
block gets the human-step sentence, not the oversized-milestone sentence.

**Risk.** Low: wording only, and the stall decision is unaffected (it is judged on the row).

### 3.2 F3 — a resume that cannot happen must say so · effort S · risk Low · Batch A

**Problem.** `drive.ts:105` logs only when `result.advanced` is true. When
`resumeFromOperatorPause` returns `no_marker` — which an unclosed fence anywhere above the block
guarantees (reproduced) — the operator sees nothing at all, and the task is re-listed under
"Waiting on operator" telling them to tick a box they have already ticked. There is no diagnostic
anywhere in the system.

**Fix.**
1. In `drive`, on `advanced: false` for a `need_operator` task, `log.warn` the reason in the
   operator's words. `incomplete_checklist` already speaks for itself in `advancement.ts:196-201`,
   so exclude it and cover `no_marker`, `no_questions_file`, `unparsable_table`.
2. For `no_marker` specifically, add the cheap diagnosis: if the raw file contains the marker text
   but `findLastPauseBlock` returned null, say *"the pause block is inside an unterminated code
   fence — check for a stray ``` above it"*. This is a substring test on content already in hand,
   not a second parser.

**Files.** `src/cli/drive.ts`, `src/state/advancement.ts` (or `operator-block.ts` for the
diagnosis helper).

**Tests.** `drive.test.ts`: a `need_operator` task with a ticked marker hidden behind a stray
fence logs the fence warning and does not dispatch. One test per other reason.

**Risk.** Low — additive logging. This makes the failure *legible*, it does not make it *stop
happening*; F1 is what would let the block be found. The ordering is deliberate: the diagnostic
stays worth having after F1, for the unclosed fence CommonMark genuinely leaves open.

### 3.3 F4a — de-head the worked example · effort XS · risk Low · Batch A

**Problem.** `EXECUTION_TABLE_SPEC` ends with a worked example under a real `## Execution Status`
heading (`execute-table.ts:477`), interpolated verbatim into both prompts. An agent that quotes the
contract into its playbook — which the prompts invite — hands the loop a table that outranks the
real one, and `setMilestoneStatus` then writes into it.

**Fix.** Present the example's table *without* a heading line: replace `## ${EXECUTION_STATUS_HEADING}`
with a non-heading lead-in — `Under your \`${EXECUTION_STATUS_HEADING}\` heading:` — leaving the
table rows byte-identical. The contract still teaches the shape; the prompt no longer emits a line
that can become the file's winning heading.

**Why not fence it instead (F4b).** Fencing is inert while the parser ignores fences: a fenced
example parses exactly as an unfenced one does (finding A). Fencing lands in Batch B, *after* F1
gives fences meaning. De-heading is the mitigation that works today.

**Files.** `src/pipeline/execute-table.ts` (the template literal only).

**Tests.** `execute-table.test.ts:488` ("its worked example round-trips") must be rewritten — it
currently asserts the very property being removed. Keep its intent (the example obeys the contract
it teaches) by parsing the example under a synthetic heading:
`parseExecutionStatus("## Execution Status\n" + EXAMPLE)`. Add the guard that replaces it: the
shipped spec, and both rendered prompts, contain **zero** heading lines matching
`/^#{1,6}\s+.*Execution Status/`. `prompts.test.ts:300` asserts a table *row*
(`| G1 | Operator merges PRs #12 and #14 |`) and is unaffected.

### 3.4 F5 — clear `resumed_at` at a gate · effort XS · risk Low · Batch A

**Problem.** `clearResumedAt` fires only when a *run* finishes the resumed row
(`execute.ts:519-521`). A gate never runs — `settleRow` marks it `done` — so `resumed_at: G1`
stays in `state.yml` indefinitely. If an operator later renumbers an agent row to `G1`, it silently
gets threshold 1 and pauses after one session.

**Fix.** In `resumeFromOperatorPause`, after `settleRow` has settled an operator-owned row to
`done`, clear `resumed_at`. The resume budget only means something for a row that will run.

**Files.** `src/state/advancement.ts`.

**Tests.** `advancement.test.ts`: resuming a gate leaves `resumed_at` unset; resuming an
agent-owned row still sets it (the AC9 behaviour must not regress).

### 3.5 F6 — document why the two trailing-row filters differ · effort XS · risk Nil · Batch A

**Decided: no behaviour change.** The earlier draft of this plan proposed aligning the two callers.
That was wrong. `done` means different things at the two call sites, and the difference is load-bearing:

- **Sign-off** (`advancement.ts:125`) runs *before* execution. A `done` cell there is the plan
  author asserting something, not the pipeline observing it — untrustworthy by construction. Were
  sign-off lenient, marking a trailing row `done` would become the way to escape the gate that
  exists to keep post-execution work out of the table. Deletion should stay the only exit.
- **The loop's end-of-run announcement** (`execute.ts:312`) runs *after*. `done` there was written
  by the pipeline or by an operator who did the work, so announcing it would be noise on every
  completed run.

**Fix.** One comment at each call site naming the other and stating the rule: *the filter differs
because `done` is an author's claim before execution and an observation after it.* The design's
line "status is the caller's filter" is what let this read as drift; say it once, properly.

**Files.** `src/state/advancement.ts`, `src/pipeline/handlers/execute.ts` — comments only.

### 3.6 F8 — housekeeping · effort XS · risk Nil · Batch A

- Delete `GATE_ID_PATTERN` (`execute-table.ts:22`). It is exported and used nowhere; the plan said
  it "labels them in logs" and no log uses it. A gate is a gate because `Owner = operator` — an
  ID-shaped constant sitting in the module invites exactly the rule the design rejected.
- Export a `readWhyLine` (or reuse `WHY_LABEL`) from `operator-block.ts` and delete `WHY_LINE` from
  `execute.ts:215`. The module's own header says it is the only place that knows the block's shape;
  today a label change has two homes.

### 3.7 F9 — document the cap-resume threshold · effort XS · risk Nil · Batch A

**Decided: docs, not behaviour.**

**The behaviour.** `pause()` marks the row `needs_operator`; on resume `settleRow` puts it back to
`pending` and `resumed_at` is set, so the next `drive` gives that row **one** session before pausing
as a stall (`thresholdFor`, `:111-113`). A large but healthy milestone interrupted by the per-drive
session cap therefore costs one pause per `drive` until it happens to land in a single session.
Bounded — no loop — but it turns a big milestone into a pause treadmill.

**Why threshold 1 is right for the other causes and arguably wrong here.** For a stall or an
agent-declared pause, the operator has looked and said "go on" — one session to prove it. A
session-cap pause is the *pipeline* interrupting itself; the operator overruled nothing.

**Why it stays as it is.** Changing it needs the pause cause at resume time, and the cause is not
machine-readable (finding B) — `PauseBlockState` carries `{ markerTicked, unchecked }` and nothing
else. Fixing it means widening the block or `state.yml` contract to carry a cause, which is M
effort and re-tunes a bound this task has just proven correct, for a treadmill no run has yet hit.

**Fix.** A paragraph in `docs/how-it-works.md` under "The four ways execution stops": a session-cap
pause resumes with one session, so an oversized milestone may pause once per `drive` until it lands
in a single session — the remedy is to split the milestone, not to re-drive. If the treadmill is
ever observed in a real run, reopen as "record the pause cause", sized M, alongside F1.

### 3.8 F1 — one fence-aware markdown scanner · effort M · risk Med · Batch B (#9)

**Problem.** Two modules read `04_execute.md` under two different rules. `operator-block.ts`
honours fences and blockquotes (`scanLines`, `:117-137`); `execute-table.ts` does not. And because
`setMilestoneStatus` re-parses, the pipeline writes into whatever the parser picked.

**Fix.**
1. Extract `scanLines` / `isHeading` from `operator-block.ts` into `src/pipeline/markdown-scan.ts`,
   unchanged in behaviour. `operator-block.ts` imports them; its tests stay green untouched — that
   is the extraction's own proof.
2. `parseExecutionStatus` selects the heading, the section end and the table rows from the scanned
   view: a heading inside a fence or a blockquote is not a heading, a `|` row inside a fence is not
   a row.
3. Error wording when the only `## Execution Status` in the file is fenced must say so —
   "found a heading inside a code fence at line N; the loop reads the file, not the example" —
   or the operator sees the existing "no heading found" and goes looking for a heading that is
   right there on screen.

**Files.** `src/pipeline/markdown-scan.ts` (new), `src/pipeline/operator-block.ts`,
`src/pipeline/execute-table.ts`.

**Tests.** The probe case promoted to a fixture (`tests/fixtures/playbooks/fenced-decoy.md`): a
fenced spec example above a real table parses to the real table. Plus: fenced-only file gives the
new error; a `>`-quoted table is inert; `setMilestoneStatus` writes into the real row with a decoy
present; all three real fixtures parse identically before and after (§6).

**Why Med risk.** Every stage that touches a playbook goes through this function, and the failure
mode of a too-strict scanner is "a valid playbook stops parsing" — which under AC7 becomes
`stage: error`, not a silent skip. That is the safe direction, but it is still a stop. Mitigations:
the extraction is behaviour-preserving for the module that already had the scanner; the three real
fixtures plus this task's own no-Owner playbook are the regression net.

### 3.9 F4b — fence the worked example · effort XS · risk Low · Batch B (#9)

Once F1 lands, wrap the example in a ```` ```markdown ```` fence — belt to F4a's braces, and it
restores the example's `##` heading so the contract shows the real shape again. Meaningless before
F1 (finding A); ships in the same commit.

### 3.10 F7 — a secret in the pause prose must not strand the task · effort S · risk Med · Batch B (#9)

**Problem.** The pause commit (`execute.ts:393`) runs the secret scan. An agent quoting an example
token in its `**Why paused:**` prose — `sk-…`, `ghp_…` (`git/secrets.ts:11-16`) — throws
`SecretDetectedError`, which `withErrorHandling` rethrows **before** `setError`
(`handlers/safe-wrapper.ts:24`). Result: `state.yml` already says `need_operator` (written at
`:391`), `04_execute.md` is uncommitted, and the pause has promised a clean working tree it did not
deliver. Recovery is a hand edit. No test covers it.

**Fix.** Catch `SecretDetectedError` around the pause `commitAll` only — the scan itself is not
weakened, and the rethrow elsewhere stays. On catch: leave the state at `need_operator`, and print
the recovery the operator actually needs — which file, which line, that the pause block is written
but uncommitted, and that redacting the token and committing by hand is the way out.

**Why Med risk.** Anything that catches a `SecretDetectedError` invites the reading that the scan
is optional. The commit message, the log wording and a test asserting the error is *not* swallowed
elsewhere all have to make it unambiguous that this catch is a reporting path, not a bypass. That
is the real cost of this fix, and it is why it sits in #9 where M8's security declaration can be
re-read alongside it.

**Tests.** A driver test: a pause whose block contains a token pattern leaves `state.yml` at
`need_operator`, prints the recovery, and does not rethrow a bare stack trace.

### 3.11 F10 — the reuse path's final message · effort M · risk Low · backlog

`pause()` on the reuse path never writes `input.agentMessage` (`execute.ts:382`). Fixing it means
a new writer in `operator-block.ts` that can insert or replace a quoted message inside an existing
block, plus normalisation tests — a session's work for content that is, on this path, usually a
restatement of the `**Why paused:**` line the block already keeps. The objective's "nothing the
agent explained is thrown away" is substantively met. If it lands, it lands with F1 while
`operator-block.ts` is already open.

---

## 4. Explicitly not fixing

| Item | Why not |
|---|---|
| R5 — `in_progress` at session end counts as a stall | Working as designed and documented in `how-it-works.md`. Changing it re-opens the bound the whole task exists to establish |
| R6 — legacy playbooks pay `MAX_STALLED_SESSIONS` per drive | D10, documented, and the remedy (add an `Owner` column) is a one-line edit the operator makes once |
| R7 / R8 — prompt-only no-push, QA scope after a gate, `drive` on the wrong branch | Already carved out as tasks #6, #7, #8 at `need_objective`. Do not pull them forward into fine-tuning |
| R9 — the AC1 "would hang" evidence is not reproducible | By the plan's own design. The old `while (true)` is in `git show main:src/pipeline/handlers/execute.ts` for anyone who wants to re-derive it; a committed hanging test is not worth the CI risk |
| M5's `bcb-time-tracker` consumer dry read | Unverifiable from this machine. Note it in the QA record as *claimed*, not *verified*, and move on |

---

## 5. Decisions taken — 2026-09-23

| # | Decision | Rationale |
|---|---|---|
| 1 | **F6 — leave both trailing-row filters as they are; document the asymmetry** | `done` is an author's claim before execution and an observation after it. Aligning them would make "mark it done" the escape hatch from the sign-off gate. Zero behaviour change, zero risk (§3.5) |
| 2 | **F9 — document the cap-resume threshold, do not change it** | The pause cause is not machine-readable (finding B), so changing it widens the block contract for a treadmill no run has hit. Reopen if observed (§3.7) |
| 3 | **Batching — Batch A (incl. F4a) in `fine_tuning`; F1 + F4b + F7 as task #9** | F4a closes the exposure window for every new playbook without touching the parser, and no existing playbook is exposed (finding C). That buys F1 the QA lap a parser-contract change deserves (§2) |

Superseded: the first draft of this plan recommended aligning the trailing-row filters (F6 option a)
and shipping F4 as "fence the example" alongside F1. Both were revised on the evidence in §0.

---

## 6. Verification

```
npm run build && npm run typecheck && npm run lint && npm run test
```

Baseline to beat: **33 files / 635 tests green** at `adf0233`. Per the plan's rule, coverage only
goes up — no test deleted without a recorded exception.

**Two existing tests change in Batch A, both deliberately:**

| Test | Change | Why it is not a coverage loss |
|---|---|---|
| `execute-table.test.ts:488` "its worked example round-trips through `parseExecutionStatus`" | Rewritten to parse the example under a synthetic heading | It asserts the property F4a removes. Its intent — the example obeys the contract it teaches — is preserved; a new test replaces the removed assertion with the stronger one (no heading line in the shipped spec or in either rendered prompt) |
| `prompts.test.ts:300` "interpolates `EXECUTION_TABLE_SPEC` verbatim, worked example included" | Unchanged | It asserts a table *row*, not the heading |

**For Batch B specifically**, add the before/after fixture equivalence check: parse `0002`, `0003`,
`0004` and this task's own playbook on `main` and on the branch, and assert the row sets are
identical. That is the only evidence that a fence-aware parser did not quietly change how an
in-flight playbook reads.

Scratch probes go in the session scratchpad, never inside the repo — the backlog's process note
from #13 applies here too.

---

This file carries no advancement marker on purpose: `fine_tuning` reads its marker from
`05_qa.md` (`STAGE_QUESTIONS_FILE`, `src/pipeline/states.ts:62`), and a second
"Ready to advance to Cleanup" line in the same plan directory is the ambiguity this very task
set out to remove.
