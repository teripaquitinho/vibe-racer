# Bug: execute lap loops forever on a milestone the agent cannot complete

Status: analysis + proposed fix (not implemented)
Seen: twice, most recently on host task `plans/002_beta/0016_unify-ui-brand-style` (M9 gated on PRs 0/1/2/9/3 being merged)

---

## 1. Symptom

The execute lap (`ready_to_execute`) reaches a milestone that needs a human, for example
"open and merge PRs 0 → 1 → 2 → 9 → 3 before M9". Each session does the right thing: it
leaves the guardrails alone, changes no files and explains how to unblock. Then
`handleExecute` starts another session on the same milestone. That session reaches the same
conclusion, and the cycle continues until someone notices and hits Ctrl-C.

What you see in the terminal:

```
Executing milestone 9 (9 remaining)...
  … "I didn't start M9 … the status stays ⏸ PAUSED AT M8 GATE … To unblock: …"
Milestone 9 — agent already committed          ← nothing was committed; nothing changed
Executing milestone 10 (9 remaining)...         ← same "remaining" count, counter keeps climbing
  … same refusal …
Executing milestone 11 (9 remaining)...
```

Each iteration is a full paid SDK session. None of them makes progress.

## 2. Root cause

### 2.1 The handler has no progress check (primary cause)

`src/pipeline/handlers/execute.ts:21-45`

```ts
while (true) {
  const pending = countPendingMilestones(content);
  if (pending === 0) break;          // ← the ONLY exit
  await runAndStream({ ... });
  await commitAll(...);
  milestone++;
}
```

- The loop can only end when no `| pending |` rows remain. If a session ends without
  changing the table, the next pass sees the same count and starts again.
- It never compares the table before and after a session, so an unchanged table goes
  unnoticed.
- It never caps attempts, either per milestone or per `drive`.
- It ignores what the session said. `runAndStream` returns the agent's final message (the
  exact unblock instructions above), and the handler throws it away.
- `milestone++` counts sessions, not milestones. The "Milestone N — agent already committed"
  log line hides the stall: an empty commit is reported as success.

### 2.2 Stopping is not a valid outcome for the agent

`executeMilestonePrompt` (`src/claude/prompts.ts:477-520`) gives the agent two options:
finish the milestone (`done`) or "adapt the implementation but keep the same goals". It has
no instruction and no status value for "this step is not mine to do". The plan prompt does
list `blocked` as a status (`prompts.ts:413`), but:

- the execute prompt never mentions `blocked`, and
- the handler has no idea what `blocked` means (see 2.4).

So the agent does the only safe thing: it refuses in prose and leaves the table unchanged.
That is exactly the condition 2.1 cannot detect.

### 2.3 The plan lap writes operator steps as prose, not as steps

The plan prompt (`prompts.ts:386-425`) asks for "Sequential execution … running continuously
without pausing between milestones". It has no concept of a step that a human owns. When the
real plan needs human gates (open PRs, merge, screenshot checks, a dev soak), the planner
writes them as hard-stop prose between rows ("M9 can't start until PRs … are merged"). They
don't become rows in the status table. Result:

- At `need_execution` sign-off, the operator ticks "Ready to advance to Execution" without an
  explicit list of the actions they owe.
- The table still shows M9 as `pending`, so the handler treats it as agent work.

### 2.4 Latent sibling bugs in the same function

These haven't caused a hang yet, but they share the same root cause (the handler trusts a
regex count and nothing else):

1. **`blocked` silently skips work.** If an agent marks a milestone `blocked`, the pending
   count drops and the loop moves on to later milestones, which may depend on it. When every
   row is `done` or `blocked`, the handler advances to `ai_qa` as if execution had finished.
2. **A table that can't be parsed counts as finished.** If the playbook's status column
   doesn't match `/\|\s*`?pending`?\s*\|/` (other casing, an emoji status such as
   `⏸ paused`, a renamed column), `pending === 0` on the first read. The task goes straight
   to `ai_qa` with nothing executed.
3. **The count covers the whole file.** A `pending` cell in the "Milestone summary" table or
   in a prose example is counted too, so a milestone that is really done can still keep the
   loop alive.

### 2.5 The guardrails are not the bug

The guardrails worked: the agent did not push, open PRs or merge. Nothing here needs
loosening. One nuance for accuracy: in this repo, `guard.ts` does **not** block `git push`,
`gh pr create` or `gh pr merge`. The refusal came from the playbook's own rule ("the executor
never opens or merges PRs") and the "vibe-racer never pushes" policy, not from `canUseTool`.
So today that guardrail exists only as a prompt instruction; see §5 (optional hardening).

## 3. Desired behaviour (from the operator)

1. **At sign-off (plan lap → `need_execution`):** every step the operator owns is marked in
   `04_execute.md` as a step that needs the operator, so the person signing off sees what
   they owe.
2. **During execution:** when vibe-racer reaches a step it can't do, whether planned for the
   operator or discovered at run time, it does **not** retry forever. It pauses: the state
   says the execute lap needs the operator, and `04_execute.md` spells out what to do.
3. **Resume:** the operator does the work, ticks a box and runs `drive`. Execution picks up
   where it stopped.

(Note: the state file is `state.yml`, and the pipeline owns it. The agent never writes to it
(guard Rule 0), so the handler has to set the pause, not the agent.)

## 4. Proposed fix

### 4.1 New pause stage: `need_operator`

Add `need_operator` to `STAGES` in `src/state/schema.ts`. Like `error`, it sits **outside**
the linear `STAGE_ORDER`: it's a detour that always comes back to `ready_to_execute`.

`state.yml` while paused:

```yaml
stage: need_operator
title: unify-ui-brand-style
paused_stage: ready_to_execute
operator_reason: "M9 requires PRs 0,1,2,9,3 merged into main"
operator_milestone: M9
prev: ready_to_execute
next: ready_to_execute
```

- Schema: add optional `paused_stage`, `operator_reason` and `operator_milestone`.
- `writeState`: for `need_operator`, set `prev = next = paused_stage` (mirrors how `error` uses
  `error_stage`).
- `states.ts`: `isHumanStage("need_operator")` is already true because the stage is neither an
  agent stage nor `error` or `done`, so `drive` and `pitwall` list it under "waiting on human"
  for free. Add a `STAGE_NEXT_NAME` entry ("Resume Execution"), and give `pitwall` a separate
  "Waiting on operator" group that prints `operator_reason`.
- Why not reuse `error`? `error` means something broke, and `--retry` would re-dispatch
  straight back into the same wall. `need_operator` means the pipeline is working as designed
  and is waiting on a person.

### 4.2 Plan lap: operator steps become first-class rows

Change `planReviewPrompt` (the File 2 section, `prompts.ts:405-425`):

- Status table gets an **Owner** column:
  `| Milestone | Name | Owner | Status | Commit | Notes |`, where Owner is `agent` or `operator`.
- Status values: `pending` | `in_progress` | `done` | `needs_operator`. Drop `blocked` (see
  4.4).
- New rule: *any action vibe-racer must not or cannot take is its own milestone row with
  `Owner = operator`, never a prose "hard stop"*. List the categories explicitly: push, open
  or merge a PR, code review, deploy, a manual visual or screenshot check, a soak or wait
  period, secrets or credentials, external dashboards or services, and anything outside the
  repo.
- Each operator row gets a matching section in `03_plan.md` with a `- [ ]` checklist of
  concrete actions, plus the **verification** the next agent milestone runs to confirm them
  (for example "`git merge-base --is-ancestor feat/0016-pr3-brand-tokens origin/main`").
- Stop requiring "running continuously without pausing"; replace it with "running
  continuously between operator gates".

Example:

```
| Milestone | Name                      | Owner    | Status  | Commit | Notes |
| M8        | Brand tokens              | agent    | done    | a1b2c3 |       |
| G1        | Open + merge PRs 0,1,2,9,3 | operator | pending |        | gate  |
| M9        | Storybook                 | agent    | pending |        |       |
```

At `need_execution` sign-off, `tryAdvance` logs the operator rows ("This plan contains 2
operator gates: G1, G2"). The person signing off now sees what they owe (**requirement 1**).

### 4.3 Execute handler: parse, detect stalls, pause

Rewrite `handleExecute` around a real parser instead of a regex count.

**a. Parse the Execution Status table only** (new `parseExecutionStatus(content)` in
`src/pipeline/validation.ts`). It returns `{ id, name, owner, status }[]` and **throws** if no
table with Milestone and Status columns is found, which fixes 2.4.2. Rows without an Owner
column default to `agent` (backward compatible with existing playbooks). It only reads the
table under the "Execution Status" heading, which fixes 2.4.3.

**b. Loop logic:**

```
rows = parse()
loop:
  next = first row whose status != done
  if none                          → advance to ai_qa (existing path)
  if next.status == needs_operator → pause(next, from playbook)          # declared by agent earlier
  if next.owner == operator        → pause(next, from 03_plan.md section) # planned gate: NO session started
  before = snapshot(rows)
  result = runAndStream(...)
  commitAll(...)
  rows = parse()
  if row(next.id).status == done   → stalls = 0; continue                 # progress
  if row(next.id).status == needs_operator → pause(next, from agent's Operator actions block)
  stalls++                                                                 # undeclared stall (today's bug)
  if stalls >= MAX_STALLED_SESSIONS (default 2) → pause(next, reason = agent's final message `result`)
```

- **Planned gates cost nothing.** The handler pauses before starting a session.
- **Declared stalls pause after one session.** The agent sets `needs_operator`.
- **Undeclared stalls pause after at most two sessions.** The agent refuses in prose (the
  exact case reported) or the session crashes or hits max turns. In that case the handler
  writes the agent's final message into `04_execute.md` for the operator, so nothing the
  agent explained is lost.
- **Hard backstop:** a cap of `initialPendingRows + MAX_STALLED_SESSIONS` total sessions per
  `drive`. Even a parser bug can never turn the loop back into `while (true)`.
- Log accurately: `Executing M9 (attempt 2/2, 9 remaining)`. No more "agent already
  committed" when nothing changed.

**c. `pause(row, reason)`** (handler-owned, since the agent can't write state):

1. Make sure `04_execute.md` has an Operator actions block for this pause (format in 4.5).
   If the agent already wrote one, keep it; otherwise the handler appends one built from the
   plan section or the agent's final message.
2. Set the row's status to `needs_operator` if it isn't already.
3. `commitAll("vibe-racer: paused for operator at <id> for #N")`.
4. Write `state.yml`: stage `need_operator`, with `paused_stage`, `operator_reason` and
   `operator_milestone` filled in.
5. Print a pit-board message: what is blocked, the checklist, and "tick the box in
   04_execute.md, then run `vibe-racer drive`".

This covers **requirement 2**.

### 4.4 Execute prompt: give the agent a legal way to stop

Add to `executeMilestonePrompt`:

- *"If the first unfinished milestone (or anything it depends on) needs an action you must not
  take or cannot take from inside this repo (push, open or merge a PR, review, deploy, manual
  visual check, waiting period, credentials, external systems), or a stated precondition
  isn't met: do NOT attempt it, do NOT work around it and do NOT start a later milestone. Set
  its status to `needs_operator`, append an Operator actions block to `04_execute.md` in
  exactly this format: …, and end the session."*
- *"You never push, open PRs, merge PRs or deploy."* This makes the policy explicit in the
  prompt, not just in whatever the plan happened to write.
- *"If a milestone depends on an operator gate, first verify the gate's outcome with the
  commands listed in 03_plan.md (read-only: `git fetch`, `git log`, `gh pr view`). If it's
  unmet, use `needs_operator`."* This matters on resume: a box ticked too early costs one
  session and pauses again instead of looping.

Remove `blocked` as a status. It overlapped with `needs_operator`, and the handler never gave
it a meaning (2.4.1). If an old playbook still contains `blocked`, the parser treats it as
`needs_operator`, which pauses instead of skipping.

### 4.5 Operator actions block in `04_execute.md` and resume

Format, appended once per pause (numbered so history is kept):

```markdown
## Operator actions — pause 1 (G1)

**Why paused:** M9 builds on the layout API, token names and logo components from PRs 0,1,2,9,3,
which are not merged into `main` (origin/main still at 273c1c9).

- [ ] Open PRs against `main` in order 0 → 1 → 2 → 9 → 3 (bodies in `pr-bodies/`)
- [ ] If `main` moved: rebase the branch and rerun the full gate before opening
- [ ] Clear human gates: screenshot checks, PR 3 dev soak
- [ ] Merge all five PRs

**Agent will verify on resume:** `git fetch && git merge-base --is-ancestor <each branch> origin/main`

- [ ] Operator actions complete — resume execution
```

**Resume (requirement 3).** `drive` → `tryAdvance` for `need_operator`:

1. Look at the **last** `## Operator actions — pause N` block only. Earlier pauses' ticked
   boxes must never resume a new pause (the same class of bug as issue #3).
2. Require the dedicated marker `- [x] Operator actions complete — resume execution`. It is
   deliberately **not** `Ready to advance …`, because `04_execute.md` already carries the
   ticked `Ready to advance to Execution` from sign-off. A shared marker would resume the task
   right away, the same stale-tick bug issue #3 fixed.
3. Require every `- [ ]` in that block to be ticked (reuse the `validateDecisionChecklist`
   logic scoped to the block). If any are unticked, untick the resume marker and list what's
   left, as `need_decision` does today.
4. If the paused row has `Owner = operator`, set its status to `done`. If it's an agent row
   that hit `needs_operator`, reset it to `pending` so the agent retries it (with verification).
5. `updateStage(..., paused_stage)`, clear the `operator_*` fields, and let `drive` dispatch
   `ready_to_execute` in the same run.

**Invariant change.** `STAGE_QUESTIONS_FILE` stays injective on `(file, marker)` pairs, not on
file alone. `need_execution` and `need_operator` share `04_execute.md` but use different
markers. Update the Key decision in `CLAUDE.md` to say this, and add a test asserting that the
pairs are unique.

## 5. Optional hardening (separate change, tightens guardrails)

The rule against pushing or merging lives only in prompts today (§2.5). If we want it
enforced, add a `ready_to_execute` deny list to `guard.ts`: `git push`, `gh pr create`,
`gh pr merge`, `gh release`, `gh workflow run`. Read-only `gh pr view` / `gh pr list` and
`git fetch` stay allowed so the agent can still check operator gates. This change doesn't
loosen anything, and it stays independent of the loop fix.

## 6. Files touched

| File | Change |
|---|---|
| `src/state/schema.ts` | `need_operator` stage; `paused_stage`, `operator_reason`, `operator_milestone` |
| `src/state/store.ts` | `writeState` prev/next for `need_operator`; `pauseForOperator()` helper |
| `src/pipeline/states.ts` | `STAGE_NEXT_NAME`; keep it out of `STAGE_ORDER`; `(file, marker)` map |
| `src/pipeline/validation.ts` | `parseExecutionStatus`, `setMilestoneStatus`, operator-block helpers |
| `src/state/advancement.ts` | `need_operator` resume path; log operator gates at `need_execution` |
| `src/pipeline/handlers/execute.ts` | parser-based loop, stall detection, cap, `pause()` |
| `src/claude/prompts.ts` | plan prompt: Owner column + operator rows; execute prompt: `needs_operator` protocol |
| `src/cli/drive.ts`, `src/cli/pitwall.ts` | "Waiting on operator" group with reason + file hint |
| `docs/how-it-works.md` | state machine detour; the "Execution Loop" section is already out of date (it says one session and checkboxes; in reality it's one session per milestone and a status table) |
| `CLAUDE.md`, `CHANGELOG.md` | Key decision: operator gates + `(file, marker)` injectivity |

## 7. Tests

`tests/pipeline/handlers/execute.test.ts`:

- **The reported case:** the session leaves the table unchanged → exactly `MAX_STALLED_SESSIONS`
  sessions run, then the stage becomes `need_operator` and the agent's final message lands in
  `04_execute.md`. It never loops.
- The agent sets `needs_operator` → pause after 1 session, with no retry.
- First unfinished row has `Owner = operator` → `runAndStream` **not called**, and the task
  pauses.
- Progress resets the stall counter (M1 done, then M2 stalls twice → pause at M2).
- The total-session backstop holds even if the parser mock always returns pending.
- `blocked` in a legacy playbook → pause, not skip.
- No parsable status table → throws (goes to `error`), never advances to `ai_qa`.
- `pending` in the summary table only → not counted.

`tests/state/advancement` (or `tests/cli/drive.test.ts`):

- Ticked `Ready to advance to Execution` alone does **not** resume `need_operator`.
- A ticked resume marker in an **earlier** pause block does not resume the current pause.
- Resume with unticked items → marker unticked, items listed, stage unchanged.
- Resume on an operator row → row `done`, stage `ready_to_execute`; on an agent row → row `pending`.
- `(file, marker)` pairs across stages are unique.

`tests/claude/prompts.test.ts`: the plan prompt mentions the Owner column and the operator
categories; the execute prompt mentions `needs_operator` and the no-push/no-PR rule.

## 8. Open questions

1. **`MAX_STALLED_SESSIONS` default:** 2 (one retry for a flaky session) or 1 (cheapest)?
   Proposal: 2, overridable later via `.vibe-racer.yml` (`execute.max_stalled_sessions`) if
   it's ever needed. No config key in v1.
2. Should resuming run the verification commands in the **handler** (deterministic, no
   session cost) instead of the agent? That's more robust, but it means the plan has to emit
   machine-runnable checks. Proposal: agent-side in v1, handler-side later.
3. Should operator gate IDs use a distinct prefix (`G1`) or keep milestone numbering (`M9a`)?
   Proposal: `G<n>`, so gates are easy to spot in logs.

## 9. Workaround until fixed

When the log shows the same "N remaining" count on two consecutive iterations, Ctrl-C.
Complete the unblock steps the agent printed, then run `vibe-racer drive` again. The task is
still at `ready_to_execute`, so execution resumes at the first `pending` milestone.
