# Product Specification — #5: infinite-loop-fix

> **Role**: Senior Product Designer
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-09-21
> **Inputs**: `00_objective.md`, `01_product_questions.md` (Q1–Q7),
> `execute_infinite_loop_bug.md` (root-cause spec, deleted when this work lands)

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [The Operator's Story](#2-the-operators-story)
3. [Feature 1 — Operator gates are declared at plan time](#3-feature-1--operator-gates-are-declared-at-plan-time)
4. [Feature 2 — Execution pauses instead of spinning](#4-feature-2--execution-pauses-instead-of-spinning)
5. [Feature 3 — The pause block in `04_execute.md`](#5-feature-3--the-pause-block-in-04_executemd)
6. [Feature 4 — Resume and gate verification](#6-feature-4--resume-and-gate-verification)
7. [Feature 5 — Visibility: `pitwall`, `drive`, `radio`](#7-feature-5--visibility-pitwall-drive-radio)
8. [State machine and workflow](#8-state-machine-and-workflow)
9. [Configuration and prerequisites](#9-configuration-and-prerequisites)
10. [Edge cases and error recovery](#10-edge-cases-and-error-recovery)
11. [Scope boundaries](#11-scope-boundaries)
12. [Closing step — review the security declaration](#12-closing-step--review-the-security-declaration)
13. [Follow-up tasks this spec creates](#13-follow-up-tasks-this-spec-creates)
14. [Acceptance criteria](#14-acceptance-criteria)

---

## 1. Product Overview

### The problem in one paragraph

The execute lap runs one Claude session per milestone and ends only when no `pending` row
remains in the Execution Status table of `04_execute.md`. When a milestone needs an action
vibe-racer must not take — push, open or merge a PR, deploy, a visual check, a waiting period —
the agent does the right thing: it changes nothing and explains the blocker in prose. The handler
sees the same table, the same count, and starts another paid session on the same milestone.
Forever. It has happened twice, most recently on host task `0016_unify-ui-brand-style`.

**The guardrails are not the bug.** The agent's refusal is correct behaviour. The bug is that the
pipeline has nowhere to put a refusal, so it retries it.

### What this task delivers

A refusal gets a destination. Three product changes, in the order the operator meets them:

| # | Change | Operator-visible effect |
|---|---|---|
| 1 | **Operator gates are first-class rows** in the plan | At sign-off you see the list of things *you* owe before you tick the box |
| 2 | **`need_operator` — a new pause stage** | The lap stops and hands the car back to you, instead of burning sessions |
| 3 | **Every pause writes its instructions into `04_execute.md`** | You can act with no terminal scrollback, then tick and `drive` |

Plus two latent bugs fixed on the way: a `blocked` row silently skipping real work, and an
unparseable status table counting as "nothing pending" and jumping straight to QA.

### Design principles for this feature

1. **A pause is the pipeline working, not failing.** It is never styled, worded or stated as an
   error (Q5).
2. **Termination is structural.** The loop must be bounded even if the agent ignores every
   instruction and the parser misreads the table (objective constraint).
3. **Nothing the agent explained is thrown away.** Today the unblock instructions exist only in
   terminal scrollback; after this task they are always written to the operator's file (Q3).
4. **The status table is the operator's file as much as the agent's.** Hand-edits are a supported
   escape hatch, not a hack (Q3).
5. **`state.yml` stays pipeline-owned.** The agent signals through `04_execute.md`; the handler
   writes the stage (objective constraint, guard Rule 0).

---

## 2. The Operator's Story

### Today (the reported failure)

```
Executing milestone 9 (9 remaining)...
  … "I didn't start M9 … To unblock: merge PRs 0,1,2,9,3 …"
Milestone 9 — agent already committed          ← nothing was committed
Executing milestone 10 (9 remaining)...        ← same count, counter climbing
  … same refusal …
```
Until a human notices and hits Ctrl-C. The instructions scroll past. Nothing is recorded.

### After this task

```
Executing M8 (attempt 1/2, 3 remaining)...
M8 committed: a1b2c3
G1 is owned by the operator — pausing before it. No session started.

  ⏸  Task #5 paused — waiting on operator
      G1 — Open + merge PRs 0,1,2,9,3
      1 item to do in plans/0005_infinite-loop-fix/04_execute.md
      When done, tick every box and run `vibe-racer drive`.
```

The operator opens `04_execute.md`, finds pause block 1 with a checklist, does the work, ticks the
boxes and the resume marker, runs `drive` — and execution continues at M9 in that same invocation
(Q4).

---

## 3. Feature 1 — Operator gates are declared at plan time

> Traces to: **Q1**; objective §Target behaviour 1.

### 3.1 The Owner column

The Execution Status table in `04_execute.md` gains an **Owner** column with two values,
`agent` and `operator`:

```
| Milestone | Name                       | Owner    | Status  | Commit | Notes |
| M8        | Brand tokens               | agent    | done    | a1b2c3 |       |
| G1        | Open + merge PRs 0,1,2,9,3 | operator | pending |        | gate  |
| M9        | Storybook                  | agent    | pending |        |       |
```

Statuses are `pending` | `in_progress` | `done` | `needs_operator`. `blocked` is removed
(objective, Decisions already made).

### 3.2 What must become a gate row

The plan lap stops writing human-owned steps as prose between rows. Any action vibe-racer must not
or cannot take becomes **its own row** with `Owner = operator`. The categories are stated
explicitly in the plan prompt:

- push, open a PR, merge a PR, code review
- deploy, release, run a workflow
- manual visual or screenshot checks
- soak periods and any "wait N hours/days"
- secrets, credentials, external dashboards and services
- anything outside the repository

Each gate row gets a matching section in `03_plan.md` holding a concrete checklist and the
**verification** the next agent milestone will run to confirm the gate cleared (§6).

### 3.3 Gate IDs: `G<n>`

Gates are numbered independently of milestones: `G1`, `G2`, … (Q1). Rationale: a gate must be
recognisable at a glance in the table, in logs and in `pitwall`; `M9a` reads as agent work and
renumbers awkwardly when milestones move.

### 3.4 Where the operator sees the gates *before* signing off

Both surfaces, with the file as the primary one (Q1):

**Primary — in `04_execute.md`, directly above the `# Complete` checkbox**, the plan lap writes an
"Operator gates" summary section:

```markdown
## Operator gates in this plan

Execution will pause at each of these and wait for you.

- **G1** — Open + merge PRs 0,1,2,9,3 — before M9
- **G2** — Visual check of the Storybook build — before M12
```

If the plan has no gates, the section is still written and reads:
*"None — execution runs start to finish without you."* An explicit "none" is a promise the
operator can hold the plan to (Q1).

**Secondary — in the terminal.** When `drive` advances past `need_execution`, it prints the same
list as a confirmation: `This plan contains 2 operator gates: G1, G2`. It does **not** block and
does **not** ask for a second confirmation — the tick is the consent (Q1).

### 3.5 Prompt change to the plan lap

"Milestones running continuously without pausing" becomes "running continuously **between
operator gates**" (objective §4.2). The plan lap is otherwise unchanged.

---

## 4. Feature 2 — Execution pauses instead of spinning

> Traces to: **Q2**; objective §Target behaviour 2.

### 4.1 The new stage

`need_operator` — a pause stage modelled on `error`: outside the linear `STAGE_ORDER`, always
returning to `ready_to_execute`. `state.yml` records `paused_stage`, `operator_reason` and
`operator_milestone` while paused.

It is **not** `error`, because `error` means something broke and `--retry` would walk straight
back into the same wall (objective, Decisions already made). `--retry` does not touch paused
tasks (Q5).

### 4.2 The four ways execution stops

| Trigger | Sessions spent | Detected by |
|---|---|---|
| **Planned gate** — first unfinished row has `Owner = operator` | **0** — pauses before any session starts | Handler, reading the table |
| **Agent-declared** — agent sets the row to `needs_operator` | **1** | Handler, re-reading the table after the session |
| **Undeclared stall** — row unchanged after a session | **2** (1 after an overrule, §4.4) | Handler, comparing the row before/after |
| **Session backstop** — total sessions in one `drive` hit the cap | cap | Handler counter |

All four produce the same outcome: `stage: need_operator`, a numbered pause block appended to
`04_execute.md`, a commit, and a pit-board message. None of them is an error.

### 4.3 What counts as a stall

Judged on **the milestone's row in the Execution Status table, nothing else** (Q2). After a
session, if the current milestone is not `done` and not `needs_operator`, that session counts as a
stall — whether or not it committed code. Progress on the *row* is the only thing that resets the
counter.

One sentence the operator can hold in their head:
*"Two sessions on the same milestone without finishing it, and I stop and ask you."*

### 4.4 Thresholds

- **Default threshold: 2** (Q2). One retry absorbs a session that ended early or ran out of room
  on a large milestone; a second identical outcome is a pattern, not bad luck.
- **After an overrule, the threshold is 1** (Q2). If the task was just resumed from a pause at
  this same milestone, a single session that does not finish it pauses again immediately. The
  operator already saw this wall once; they should not pay twice to see it again.
- **Crashes are not stalls.** A session that throws goes to `error` via `withErrorHandling`, as
  today (Q2, objective open question 1).
- **No configuration key in v1** — not in `.vibe-racer.yml`, not as a CLI flag (Q2). If nobody
  asks for it, it never needs to exist.

### 4.5 The per-`drive` session backstop

A hard cap on total sessions in one `drive` invocation guarantees termination even if the parser
is wrong (objective constraint).

**Sizing rule (Q2):** because a session that commits code without finishing counts as a stall, a
legitimate run can legitimately take up to `threshold` sessions per milestone. The cap is
therefore sized from that worst case — *pending agent milestones × threshold, plus slack* — not
"pending + 2". The cap must never trip on a healthy run.

**If the cap does trip, the task pauses like any other stall — it is not an error** (Q2). The
pause block says so:
*"Stopped after N sessions in one run — this is a safety limit; review the Execution Status table
before resuming."*

### 4.6 Honest logging while it happens

Terminal output during execution must be honest (Q2):

- show milestone ID, attempt number and remaining count:
  `Executing M9 (attempt 2/2, 9 remaining)`;
- never report an empty commit as success — today's `Milestone N — agent already committed` line,
  printed when `commitAll` returns nothing, must not survive in that form;
- `milestone++` counting sessions rather than milestones is gone; IDs come from the table.

### 4.7 The agent gets a legal way to stop

The execute prompt gains (objective §4.4, in scope):

- the `needs_operator` protocol — set the row's status, append an Operator actions block in the
  exact format, end the session; do **not** attempt the step, do **not** work around it, do
  **not** start a later milestone;
- the explicit rule *"you never push, open PRs, merge PRs or deploy"* — today this lives only in
  whatever the plan happened to write;
- gate verification before any milestone that depends on a gate (§6).

---

## 5. Feature 3 — The pause block in `04_execute.md`

> Traces to: **Q3**; objective §Target behaviour 3.

### 5.1 Format

One numbered block per pause, appended so history is kept. Only the **latest** block counts for
resume (objective, Decisions already made).

```markdown
## Operator actions — pause 1 (G1)

**Why paused:** M9 builds on the layout API, token names and logo components from PRs 0,1,2,9,3,
which are not merged into `main` (origin/main still at 273c1c9).

- [ ] Open PRs against `main` in order 0 → 1 → 2 → 9 → 3
- [ ] Clear human gates: screenshot checks, PR 3 dev soak
- [ ] Merge all five PRs

**Agent will verify on resume:** `git merge-base --is-ancestor <each branch> origin/main`

- [ ] Operator actions complete — resume execution

When done, switch back to branch `vibe-racer/0016_unify-ui-brand-style`, tick every box above and
run `vibe-racer drive`.
```

### 5.2 Guaranteed minimum content

Every pause block, regardless of cause, contains (Q3):

1. **which** milestone or gate paused and **why**, in one sentence;
2. a checklist with **at least one actionable item**;
3. **what the agent will check on resume** — or "None — the agent will simply retry" if there is
   no verification;
4. the **resume marker**;
5. the closing line: *"When done, switch back to branch `vibe-racer/NNNN_slug`, tick every box
   above and run `vibe-racer drive`."* (E17)

An operator who never saw the terminal must be able to act on the block alone (AC10).

### 5.3 Content by cause

| Cause | Checklist source |
|---|---|
| Planned gate | The gate's section in `03_plan.md`, as written by the plan lap |
| Agent declared `needs_operator` **with** a block | The agent's own block, used as written |
| Agent declared `needs_operator` **without** a block | Pipeline writes one from the agent's final message |
| Silent stall | Agent's final message verbatim under "What the agent said", plus one generic item: *"Resolve the issue described above (or edit the milestone in the Execution Status table)"* |
| Session backstop | The safety-limit sentence from §4.5, plus the same generic item |

**An agent-authored block is normalised, never trusted.** The execute session has `Edit` on
`04_execute.md`, so "used as written" covers its *content* only. At pause time the pipeline:
unticks every box in the block (an agent must not be able to hand the operator a pre-ticked
checklist or resume marker), sets the correct pause number, and checks the guaranteed minimum of
§5.2 — if the marker, the closing line or an actionable item is missing, it re-renders the block
from the agent's items and final message.

We do **not** try to turn prose into a multi-item checklist — a wrong checklist is worse than an
honest generic one (Q3).

### 5.4 The pause block names the kind of stall

Because the operator's next move differs (Q2), the block distinguishes:

- *"The agent made no changes in 2 sessions"* — usually an undeclared human-owned step; read the
  agent's message below. **"Made no changes" is judged on the repository** — no new commits and a
  clean working tree across the session — not on whether the pipeline's own `commitAll` returned
  empty, since the agent may commit for itself (Q2).
- *"The agent committed work in 2 sessions but did not finish M4"* — usually an oversized
  milestone; review the commits, then resume or split the milestone.

In both cases the agent's final message from the last session is included verbatim.

### 5.5 The agent's words are quoted, never live

The agent's message goes into the block as a **fenced quote**. Anything inside it that looks like
a checkbox, a pause heading or the resume marker is **inert text**: it is never counted as an
unticked item and can never resume a task. Only the checklist the block itself owns decides
resume (Q3).

If the session left no final message (it ended abnormally), the block says so plainly —
*"The agent left no closing message; see the terminal log or the last commits"* — rather than
showing an empty quote. The guaranteed minimum in §5.2 still holds (Q3).

### 5.6 The resume marker is deliberately distinct

`- [ ] Operator actions complete — resume execution`.

It is **not** `Ready to advance to …`, because `04_execute.md` already carries the ticked
"Ready to advance to Execution" from sign-off, and a shared marker would resume the task instantly
— the stale-tick failure that issue #3 fixed (objective §Target behaviour 3).

Consequently the project's "one questions file per stage" invariant becomes **injectivity on the
`(file, marker)` pair**: `need_execution` and `need_operator` share `04_execute.md` but never
share a marker. This must be stated in `CLAUDE.md` and pinned by a test (AC11).

---

## 6. Feature 4 — Resume and gate verification

> Traces to: **Q4**, **Q3**.

### 6.1 Who verifies: the agent, in v1

The next agent milestone starts by running the read-only verification the plan recorded for the
gate (Q4). **No pipeline-side command execution in this task** — turning plan text into commands
the pipeline runs on the operator's machine is a trust decision that deserves its own task.

Cost: the verification rides inside a session that was going to run anyway.

### 6.2 Ticked too early

The agent finds the gate unmet, declares `needs_operator`, and the task pauses again after that
one session with a **new** numbered pause block. The new block must say explicitly that this is a
re-pause and what the verification found (Q4):

> **Pause 2 (G1 again):** verification failed — `feat/pr3-brand-tokens` is not an ancestor of
> `origin/main`.

Cost: one session. The operator should never have to diff two blocks to understand why they are
back.

### 6.3 Gates with nothing checkable

A visual check, "wait 24h for the soak", a conversation with a colleague — these carry the
verification line **"None — operator's word"**. The pipeline trusts the tick. We do not invent
fake verifications for human judgement calls (Q4).

### 6.4 Verification that cannot run is not a failed gate

Under the recommended Docker `--network none` setup, `git fetch` and `gh pr view` fail every time.
The agent must tell *"the gate is unmet"* apart from *"I could not check"* (Q4):

1. when the check cannot run, fall back to local refs;
2. if that is inconclusive, **take the operator's tick as the answer** and say so in the session
   output.

Otherwise a sandboxed operator could never pass a gate.

### 6.5 The three supported ways out of a pause

Documented in the pause block's closing lines and in `docs/how-it-works.md` (Q3):

1. **Do the work** — tick the items, tick the marker, `drive`.
2. **Overrule the agent** ("this step is fine, try again") — tick the items and the marker without
   doing anything. The agent retries; if it hits the same wall the task pauses again after **one**
   session, whether it declares `needs_operator` or refuses silently (§4.4). Bounded, never a loop.
3. **Skip or rewrite the milestone** — edit the Execution Status table by hand: mark the row
   `done`, reword, renumber or delete it, then tick and resume.

**Resume respects hand edits (Q3).** It only touches the paused row if that row still reads
`needs_operator`, or is an untouched operator gate. A row the operator set to `done` stays `done`;
a row they renamed, renumbered or deleted does not break resume — execution continues from the
first unfinished row in the table **as the operator left it**.

There is **no new "abandon task" command** in this task. Abandoning is whatever it is today (Q3).

### 6.6 Resume mechanics

| Situation | Behaviour |
|---|---|
| Marker ticked, all items ticked | Row settled (gate → `done`; agent row → `pending` for retry), `operator_*` fields cleared, stage returns to `ready_to_execute`, **and execution continues in the same `drive` invocation** (Q4) |
| Marker ticked, some items unticked | `drive` unticks the marker, lists the outstanding items in the terminal, leaves the task paused. **No session is started.** Same feel as `need_decision` today (Q4) |
| Marker unticked | Task stays paused; `drive` lists it under "waiting on operator" (§7) |
| "Ready to advance to Execution" ticked, resume marker not | Does **not** resume (AC6) |
| Resume marker ticked in an **earlier** pause block only | Does **not** resume (AC6) |

The operator never has to run `drive` twice (Q4).

---

## 7. Feature 5 — Visibility: `pitwall`, `drive`, `radio`

> Traces to: **Q5**.

### 7.1 `pitwall`

A separate **"Waiting on operator"** group, listed **above** the ordinary pit-stop group, because
it blocks a lap that was already paid for. Each entry shows the task number and title, the paused
milestone/gate ID, the one-line reason, and the file to edit:

```
#5 infinite-loop-fix — paused at G1: PRs 0,1,2,9,3 not merged → edit plans/0005_infinite-loop-fix/04_execute.md
```

### 7.2 `drive`

- **At the moment of pausing**: a pit-board message — what paused, the checklist items, and the
  resume instruction.
- **On a later `drive` with the task still paused**: listed under the same "waiting on operator"
  wording with the reason and file. It does **not** start a session and does **not** treat the
  task as an error.
- **The hint names the real marker**: *"tick 'Operator actions complete — resume execution' in
  04_execute.md"*. It must not reuse the ordinary pit-stop wording "Ready to advance to …", which
  would point the operator at a checkbox that does not exist for a pause.
- **`--retry` does not touch paused tasks.** It remains for `error` only.

### 7.3 The one-line reason is always one line

| Pause cause | Reason line |
|---|---|
| Planned gate | The gate's name |
| Agent-declared | The agent's one-sentence "why" |
| Silent stall / backstop | Pipeline-written, e.g. `M9 — no progress in 2 sessions` |

Never the agent's multi-paragraph message (Q5).

### 7.4 Tone

A pause is the pipeline working as designed. **Neutral/amber presentation, never red error
styling, and the words "error" or "failed" never appear for a pause** (Q5).

### 7.5 `radio` at `need_operator`

**Yes** (Q5). `radio` already opens at any human stage and falls back to the Software Engineer
persona, so nothing needs "enabling" — what this task adds is a **role description written for a
pause** (explain the gate, help reword a milestone) instead of the borrowed `need_execution` one.

An operator stuck on a gate will want to ask "what exactly did you need from PR 3?" or "can this
milestone be reworded so you can do it?".

Radio at this stage is conversational and may help the operator edit the playbook. Its role
description carries the same rules as the execute lap: **it does not push, open PRs, merge or
deploy, and it does not tick the resume marker — that is the operator's.**

Be precise about what enforces this: **nothing but the prompt.** `radio` spawns the operator's own
interactive `claude` CLI; the tool guard (including Rule 0) does not run there, and the operator's
normal Claude Code permission prompts are the only gate. That is true of radio at every stage
today, not new here — but it must not be described as a guarantee (see §12.3, S2).

---

## 8. State machine and workflow

### 8.1 The detour

```
        ┌──────────────────────── resume (tick + drive) ──────────────────────┐
        │                                                                     │
need_execution ──tick──> ready_to_execute ──pause──> need_operator ───────────┘
                               │
                               └──all rows done──> ai_qa ──> fine_tuning ──> …
```

`need_operator` sits **outside** `STAGE_ORDER`, exactly like `error`. It always returns to
`paused_stage`, which is always `ready_to_execute` in v1.

### 8.2 `state.yml` while paused

```yaml
stage: need_operator
title: infinite-loop-fix
paused_stage: ready_to_execute
operator_reason: "M9 requires PRs 0,1,2,9,3 merged into main"
operator_milestone: M9
prev: ready_to_execute
next: ready_to_execute
```

The handler writes this. The agent never does — `state.yml` is pipeline-owned and guard Rule 0
denies `Write`/`Edit` to it in every pipeline session (objective constraint).

### 8.3 The execute loop, as a decision sequence

```
rows = parse(Execution Status table)        # throws if unparseable → error
loop:
  next = first row whose status != done
  if none                          → advance to ai_qa
  if next.status == needs_operator → PAUSE (block from playbook)
  if next.owner == operator        → PAUSE (block from 03_plan.md)   # zero sessions
  if sessions_this_drive >= cap    → PAUSE (safety limit)
  run session on next
  commit
  rows = parse()
  if row(next.id).status == done          → stalls = 0; continue
  if row(next.id).status == needs_operator → PAUSE (block from agent)
  stalls++
  if stalls >= threshold           → PAUSE (agent's final message)
```

`threshold` is 2, or 1 when this milestone was the one just resumed from a pause (§4.4).

### 8.4 The pause action

1. Ensure `04_execute.md` has an Operator actions block for this pause (§5). If the agent already
   wrote one, keep it; otherwise build one from the plan section or the agent's final message.
2. Set the row's status to `needs_operator` if it is not already.
3. Write `state.yml`: `need_operator` with `paused_stage`, `operator_reason`,
   `operator_milestone`.
4. Commit **both**: `vibe-racer: paused for operator at <id> for #N`.
5. Print the pit-board message.

The state write comes *before* the commit, unlike other stages where it is swept up by the next
lap. A pause can last days, and the operator's work at a gate is usually git work — switching
branches, rebasing, merging. A paused task must leave a **clean working tree**, or the first
`git checkout` the operator runs trips over a dirty `state.yml`.

---

## 9. Configuration and prerequisites

### 9.1 No new configuration

| Knob | Decision |
|---|---|
| Stall threshold | **Not configurable in v1.** No `.vibe-racer.yml` key, no CLI flag (Q2) |
| Session cap | Derived from the plan (pending agent milestones × threshold + slack), not configured (Q2) |
| Gate verification mode | Agent-side, fixed in v1 (Q4) |

### 9.2 No new prerequisites

- No new runtime dependencies (objective constraint).
- No new tool permissions; the guard is untouched (§11).
- `gh` remains **optional**: gates whose verification needs it degrade to "could not check" and
  fall back to the operator's tick (§6.4).

### 9.3 Backward compatibility with in-flight tasks

**No migration, and no warning on every run** (Q6a):

- Rows without an Owner column are treated as **agent-owned**. `plans/0001`–`0004` keep parsing
  and rendering in `pitwall` exactly as today.
- A per-`drive` warning on old playbooks would be noise the operator cannot act on.
- Old playbooks are protected by the run-time safety net instead: an undeclared human-owned step
  pauses after two sessions like any other stall.
- **Only in that situation** — a stall pause on a playbook with no Owner column — the pause block
  adds one line: *"This playbook predates operator gates; add a gate row to the Execution Status
  table if this step is yours."*
- Legacy `blocked` rows **pause rather than skip**, and the pause block says
  *"marked `blocked` by an earlier run"* so the operator understands why a task that used to sail
  past now stops.

---

## 10. Edge cases and error recovery

| # | Situation | Behaviour | Source |
|---|---|---|---|
| E1 | Status table cannot be parsed (renamed column, emoji status, missing table) | Task goes to **`error`** with a message naming the file and what was expected — *a Milestone and a Status column under "Execution Status"*. **Never** a silent jump to `ai_qa` | Q6a, AC7 |
| E2 | Legacy row marked `blocked` | Parsed as `needs_operator` → pauses instead of skipping | Q6a, AC7 |
| E3 | `pending` appears in the Milestone summary table or prose | Not counted. Only the table under "Execution Status" is read | Bug spec §2.4.3 |
| E4 | Session throws | `error` + `--retry`, unchanged. Not a stall | Q2 |
| E5 | Session ends with no final message | Pause block says so plainly; guaranteed minimum still holds | Q3 |
| E6 | Agent's message contains a checkbox or the resume marker | Inert — quoted, never counted, never resumes | Q3 |
| E7 | Operator ticks the marker but not all items | Marker unticked, items listed, task stays paused, no session | Q4 |
| E8 | Operator ticks "Ready to advance to Execution" only | No resume | AC6 |
| E9 | Earlier pause block is fully ticked, current one is not | No resume — only the last block counts | AC6 |
| E10 | Operator overrules and the wall is still there | Pauses again after **one** session, new numbered block | Q2, Q4 |
| E11 | Operator marks the paused row `done` by hand | Respected; resume does not touch it; execution continues from the next unfinished row | Q3 |
| E12 | Operator renames/renumbers/deletes the paused row | Resume does not break; execution continues from the first unfinished row as left | Q3 |
| E13 | Verification cannot run (`--network none`) | Falls back to local refs, then to the operator's tick, and says so | Q4 |
| E14 | Session cap trips | **Pause**, not error, with the safety-limit wording | Q2 |
| E15 | Plan has no gates at all | "Operator gates" section says "None — execution runs start to finish without you" | Q1 |
| E17 | Operator runs `drive` from another branch (likely — they have just been merging on `main`) | `drive` reads plan files from the working tree, so from `main` the task does not look paused and the tick is not seen. The pause block's closing line and the pit-board message therefore name the task branch: *"switch back to `vibe-racer/NNNN_slug`, tick every box above and run `vibe-racer drive`"* | Review |
| E16 | Milestone genuinely too large (commits, never finishes) | Pauses after 2 sessions with the *"committed work but did not finish"* wording, pointing at splitting the milestone | Q2 |

### Recovery guarantees

- **No pause is ever unrecoverable by hand.** The operator can always edit the table and the
  checklist and resume (§6.5).
- **No pause loses information.** The agent's last message is always in the file (§5.5).
- **No pause is ever silent.** State, file, terminal and `pitwall` all show it (§7).

---

## 11. Scope boundaries

### In scope

- `need_operator` stage: schema fields, state write prev/next handling, pause helper
- `handleExecute` rewritten around a real status-table parser: stall detection, attempt cap,
  per-`drive` session backstop, pause path, honest logging
- Status-table parsing/updating and operator-block helpers, plus the two latent bugs (`blocked`
  skipping work, unparseable table advancing to QA)
- Resume path, including checklist enforcement and the distinct resume marker
- Plan prompt: Owner column, operator gate rows, per-gate checklists and verifications, the
  "Operator gates" summary section above the sign-off checkbox
- Execute prompt: the `needs_operator` protocol, the explicit no-push / no-PR / no-deploy rule,
  gate verification before dependent milestones
- QA prompt: told which gates the task passed through, and the QA report states its coverage
  up front (Q7)
- `radio`: a role description written for `need_operator` (Q5)
- `drive` and `pitwall`: "waiting on operator" group with reason and file
- Docs: `CLAUDE.md` (the `(file, marker)` invariant, operator gates), `docs/how-it-works.md`
  (the detour; its "Execution Loop" section is already out of date), `CHANGELOG.md`
- Tests, starting with the reported case: an unchanged table must pause, never loop
- **Closing step:** a full review of the security declaration — `docs/security.md`, root
  `SECURITY.md`, the README "Security" section — against the code as shipped (§12). Docs only

### Out of scope

| Excluded | Why | Source |
|---|---|---|
| Automating the operator's work — pushing, opening PRs, merging, deploying | The product promise | Objective |
| **Guard enforcement of no-push / no-PR / no-deploy** | Bundling a guard change widens the blast radius of a bug fix and muddies the "guardrails unchanged" promise. The *prompt* rule is in scope | **Q6b** |
| Pipeline-side (handler-run) gate verification | Turning plan text into commands the pipeline runs on the operator's machine is a trust decision that deserves its own task | **Q4** |
| **Fixing QA's `git diff main...HEAD` scope after a mid-task merge** | A change to the QA lap, not the execute loop; no acceptance criterion here depends on it. Made visible, not fixed | **Q7** |
| A configuration key for the stall threshold | Not until someone asks | Q2 |
| A migration or per-run warning for pre-Owner playbooks | Noise the operator cannot act on; the run-time net covers it | Q6a |
| An "abandon task" command | Abandoning stays whatever it is today | Q3 |
| Parallel or out-of-order milestone execution | The lap stays strictly sequential | Objective |
| Retry/backoff policy for genuine session errors | That is `error` + `--retry`, unchanged | Objective |
| Anything in `backlog.md` | — | Objective |

---

## 12. Closing step — review the security declaration

> Added by the operator after product review. Runs as the **last execution milestone**, after all
> code and tests have landed and before the QA lap, so it describes the code as shipped.

`docs/security.md` is the project's public security declaration. It was last touched when the QA
lap landed (0.3.0) and the code has moved since; this task moves it again. The closing step is a
**full review of the declaration against the code as it stands** — not just a paragraph about
`need_operator`.

### 12.1 What is reviewed

`docs/security.md` is the source of truth. The two shorter statements that summarise it must agree
with it when the step is done: the root `SECURITY.md` ("Security Posture") and the "Security"
section of `README.md`.

### 12.2 How

Every factual claim in the declaration is checked against the source (`src/claude/guard.ts`,
`src/claude/session.ts`, `src/cli/radio.ts`, `src/git/secrets.ts`, the handlers' `allowedTools`)
and either confirmed, corrected, or removed. Claims are never softened to fit; if the code is
weaker than the declaration, the declaration says so under Known Limitations.

### 12.3 Known starting points

Already verified as stale or missing — the review must cover at least these:

| # | Finding | Where |
|---|---|---|
| S1 | "19 commands" blocked — `BASH_BLOCKLIST` has **18** entries, and the doc's own list has 18 | `docs/security.md`, `SECURITY.md`, `README.md` |
| S2 | "a multi-layered security system is enforced on every session" — **`radio` is not such a session.** It spawns the operator's own interactive `claude` CLI with a system prompt; `canUseTool`, Rule 0 and the path jail do not apply. Radio is absent from the declaration entirely | `docs/security.md`, `SECURITY.md` |
| S3 | Root `SECURITY.md` predates 0.3.0: it says review stages have no Bash (QA does), and omits Rule 0, `jailToPlanDir`, and the `settingSources` trust-boundary change | `SECURITY.md` |
| S4 | "vibe-racer never pushes" is a **prompt rule only** — the guard does not block `git push`, `gh pr create` or `gh pr merge`. Belongs under Known Limitations until the §13 follow-up lands | `docs/security.md` |

### 12.4 What this task itself adds to the declaration

- **`need_operator`**: a human stage; no agent session runs while paused. State is written by the
  handler only (Rule 0 unchanged).
- **Gate verification deliberately uses the network** (`git fetch`, `gh pr view`) from inside an
  execute session. State how that sits next to the Docker `--network none` recommendation (§6.4).
- **Agent prose is written into a committed file** (the pause block). It is quoted inertly (§5.5)
  so a session cannot resume its own task through its final message, and it passes through the
  pre-commit secret scan like any other staged content.
- **What an execute session can still do to the playbook**: it has `Edit` on `04_execute.md`, so
  the pause block it authors is normalised by the handler (§5.3) rather than trusted.

### 12.5 Boundaries

- **Docs only.** This step changes no code and does not move the guard — the "guardrails
  unchanged" constraint holds. A finding that needs a code change becomes a follow-up task (§13),
  listed by name in the declaration's Known Limitations.
- `CHANGELOG.md` history is not rewritten (0.1.0 may keep saying 19); the new entry notes the
  correction.

---

## 13. Follow-up tasks this spec creates

Both are created **alongside this task landing**, not inside it.

1. **"Guard enforces the no-push rule"** (Q6b) — add a `ready_to_execute` deny list for
   `git push`, `gh pr create`, `gh pr merge`, `gh release`, `gh workflow run`. The read-only
   allowances `git fetch`, `gh pr view`, `gh pr list` are a **requirement**, called out in the
   task, so gate verification (§6.1) keeps working. Ship soon after this fix.
2. **"QA scope survives mid-task merges"** (Q7) — QA is scoped to `git diff main...HEAD`; once
   pre-gate work is merged into `main` and the branch is updated, that work leaves the diff and QA
   reviews a fraction of the task. Until it is fixed, this task makes it **visible**: the QA
   prompt is told which gates were passed, the QA report states its coverage up front
   (*"This task paused at G1 (PRs merged into main). Work merged before that gate is outside this
   diff and was not reviewed here."*), and `docs/how-it-works.md` lists it as a known limitation
   of operator gates.

---

## 14. Acceptance criteria

Carried from the objective, sharpened by the answers. Each is independently testable.

**Termination**

1. **The reported case cannot recur.** With a session that leaves the status table unchanged, the
   handler runs at most the configured number of attempts, then sets `stage: need_operator` and
   writes the agent's final message into `04_execute.md`. Proven by a test that would hang on
   today's code. *(Q2, §4.3)*
2. A milestone the agent marks `needs_operator` pauses after **exactly one** session. *(Q2)*
3. A first-unfinished row with `Owner = operator` pauses with **no session started**. *(Q1, Q2)*
4. Progress resets the stall counter: M1 done then M2 stalling pauses at **M2**, not M1. *(Q2)*
5. The per-`drive` session backstop holds even if the parser always reports pending, and when it
   trips the task **pauses** — it does not error. *(Q2, §4.5)*
6. After an overrule, a single session that does not finish the same milestone pauses again. *(Q2)*

**Resume**

7. Ticking the resume checklist and running `drive` resumes execution at the paused milestone **in
   the same invocation**; an unticked item unticks the resume marker, lists what is outstanding,
   and starts no session. *(Q4)*
8. A ticked "Ready to advance to Execution", or a ticked resume marker in an **earlier** pause
   block, does not resume a current pause. *(§5.6)*
9. Resume respects hand edits: a row the operator set to `done` stays `done`; a renamed,
   renumbered or deleted row does not break resume. *(Q3)*
10. A gate ticked too early costs **one** session and produces a **new** pause block that says it
    is a re-pause and what the verification found. *(Q4)*

**Legacy and failure modes**

11. A milestone marked `blocked` in a legacy playbook **pauses instead of being skipped**, and the
    block says it was marked `blocked` by an earlier run. *(Q6a)*
12. A playbook with no parsable status table **errors** — naming the file and what was expected —
    instead of advancing to `ai_qa`. *(Q6a)*
13. A playbook with no Owner column still executes end-to-end; only a stall pause on such a
    playbook adds the "predates operator gates" line. *(Q6a)*

**Operator experience**

14. At `need_execution`, `04_execute.md` contains an "Operator gates" section above the checkbox —
    listing each gate and the milestone it precedes, or saying "None" — and `drive` prints the
    same list when advancing past it. *(Q1)*
15. `pitwall` and `drive` show paused tasks in a "waiting on operator" group with the one-line
    reason and the file to edit, in neutral/amber styling, never using the words "error" or
    "failed", and naming the real resume marker. `--retry` does not touch them. *(Q5)*
16. `04_execute.md` for a paused task tells an operator who was not watching the run exactly what
    to do and how to resume, with no terminal scrollback needed — including the guaranteed minimum
    five elements and the three ways out. *(Q3)*
17. The pause block names the kind of stall ("made no changes" vs "committed but did not finish"),
    quotes the agent's message inertly, and says plainly when there was no message. *(Q2, Q3)*
18. `radio` opens at `need_operator` with a role description written for a pause, which
    instructs it not to push, merge, deploy or tick the resume marker. *(Q5)*
19. A QA report for a task that passed an operator gate states its diff coverage up front. *(Q7)*

**Housekeeping**

20. `CLAUDE.md` states the `(file, marker)` injectivity invariant, a test enforces it, and
    `plans/0005_infinite-loop-fix/execute_infinite_loop_bug.md` is deleted. *(§5.6)*
21. The guard is unchanged by this task; `docs/how-it-works.md` documents the detour and the
    known QA-scope limitation. *(Q6b, Q7)*
22. As the last execution milestone, the security declaration has been reviewed against the code:
    `docs/security.md`, `SECURITY.md` and the README "Security" section agree with each other and
    with the source; findings S1–S4 (§12.3) are resolved; the additions in §12.4 are present; and
    no code changed in that milestone. *(§12)*
