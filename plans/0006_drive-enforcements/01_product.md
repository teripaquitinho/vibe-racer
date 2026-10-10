# Product Specification for #6: drive-enforcements

> **Role**: Senior Product Designer
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-10-10
> **Sources**: `00_objective.md` (milestones 0–3, decisions already made) and
> `01_product_questions.md` (Q1–Q9, answered). Every decision below cites the Q&A it comes from.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [The Principle, Stated Once](#2-the-principle-stated-once)
3. [Milestone 0 — Enforcement That Actually Runs](#3-milestone-0--enforcement-that-actually-runs)
4. [Milestone 1 — Plans Never Ask For A Merge](#4-milestone-1--plans-never-ask-for-a-merge)
5. [Milestone 2 — The Guard Enforces The No-Push Rule](#5-milestone-2--the-guard-enforces-the-no-push-rule)
6. [Milestone 3 — `drive` Operates On The Task Branch](#6-milestone-3--drive-operates-on-the-task-branch)
7. [Workflows & State Machine](#7-workflows--state-machine)
8. [Configuration And Prerequisites](#8-configuration-and-prerequisites)
9. [Edge Cases And Error Recovery](#9-edge-cases-and-error-recovery)
10. [Scope Boundaries](#10-scope-boundaries)
11. [Acceptance Criteria](#11-acceptance-criteria)
12. [Open Questions Handed To The Design Lap](#12-open-questions-handed-to-the-design-lap)

---

## 1. Product Overview

### 1.1 What this task is

Four changes that make one sentence true: **git belongs to the operator, and a task's cycle
belongs to its branch.**

| # | Milestone | What the operator gets |
|---|---|---|
| **0** | Enforcement that actually runs | The security guard the product has advertised since 0.1.0 is consulted on every tool call for the first time |
| **1** | Plans never ask for a merge | No plan can send them to `main` mid-execution to merge unreviewed work |
| **2** | The guard enforces the no-push rule | "vibe-racer never pushes" becomes a property of the binary, not a sentence in a prompt |
| **3** | `drive` operates on the task branch | `drive` works from any branch; a paused task is never invisible |

### 1.2 Why Milestone 0 exists and why it is first

Found 2026-10-10: `runAndStream` passes the guard as `canUseTool` while starting every session in
`permissionMode: "bypassPermissions"`, where the SDK auto-approves every tool call **before** the
callback is consulted. The SDK says so on every session
(`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`) and the warning scrolled past. `allowedTools` is an
auto-approve list, not a filter, so the per-lap tool list did not restrict either.

Consequence: neither security layer has ever been enforced in a real session. A review lap
documented as "Read, Glob, Grep, Write, path-jailed to the plan folder" in fact had Bash, Edit and
everything else, in the operator's whole repository, kept to one file by its prompt alone. This
affects published `vibe-racer@0.3.0`, not just this checkout.

Everything milestones 1–3 promise about the guard is inert until this lands. Hence the order:
**0, then 1, then 2, then 3** (objective, *Decisions already made*).

### 1.3 Who this is for

The **operator** — one human running vibe-racer on their own repository, usually alone, usually
unattended while a lap runs. Three things they care about here:

1. **They own git.** Nothing is pushed, merged, tagged, released or deployed by the agent, ever.
2. **They own their working tree.** vibe-racer never takes silent custody of uncommitted work.
3. **The claims the tool prints are true.** A security banner that prints unconditionally is
   decoration (Q7).

### 1.4 Product posture: guardrails have no switches

Both new guardrails — the sign-off refusal and the Bash deny list — are absolute. No `--force`, no
`allow:` key in `.vibe-racer.yml`, no magic comment, no `--unguarded` (Q2, Q7).

> A property with a config flag is a default, not a property. Anyone who needs vibe-racer to push
> does not want vibe-racer. (Q2)

The operator's escape hatch is not removed, because it was never in the tool: **they do the step
themselves, on their own terminal, with their own credentials.** The constraint is on the agent.

The direct consequence, which this spec treats as a hard requirement throughout: **because there
is no override, every refusal and denial message carries the whole burden of being actionable**
(Q1, Q2). Each one must name *what* was refused, *which rule* refused it, and *what to write or do
instead*.

---

## 2. The Principle, Stated Once

This is the sentence milestone 1 puts into the plan prompt, `CLAUDE.md` and `docs/security.md`:

> No milestone, gate or checklist item in a plan merges, pushes, opens or closes a PR, tags,
> releases or deploys anything — this task's or another's. If this task needs work that only
> exists on another branch or in an open PR, that is a **dependency**: name it under Assumptions &
> Gaps and in `03_plan_questions.md`, and stop planning around it.

Two legitimate answers to a dependency, and only two:

1. **Sequence** — finish and merge the other task first, then race this one.
2. **Base** — branch this task off the other task's branch.

Both are decided by the operator at `need_plan`, before a paid lap starts — never by a gate row
that pauses execution and sends them to `main`.

### 2.1 Follow-up #7 is closed by construction

`0007_qa-scope-survives-mid-task-merges` asked how QA could review a task when a gate had merged
part of it into `main` and removed it from `git diff main...HEAD`. Once no gate may merge, nothing
leaves the diff mid-cycle and the question has no instance. Its four open questions are **dropped,
not answered**, and the coverage statement the QA prompt prints today is removed with them
(objective, *Why* and *Decisions already made*).

---

## 3. Milestone 0 — Enforcement That Actually Runs

### 3.1 Layer 2 moves to where the SDK looks

The decision function in `src/claude/guard.ts` is unchanged in substance — same rules, same
messages, same audit entries — and is registered as a **`PreToolUse` hook**, which the SDK consults
under `bypassPermissions` (probed; objective, *Decisions already made*). Every tool call of every
guarded session goes through it, **including tools that are not in the lap's list**.

Rules that start running for the first time, unchanged: Rule 0 (`state.yml` is pipeline-owned), the
sensitive-path blocklist, path containment, `.env` protection, the plan-folder jail at review
stages, the review-stage Bash block, and `BASH_BLOCKLIST` (18 commands plus interpreter-aware
network detection).

### 3.2 Layer 1 becomes a restriction, not a hint

A tool outside the lap's list is **denied**, not merely unlisted. `Skill` keeps its existing
allowance when a lap resolves skills. *The mechanism* — removing the tool from the model's context,
a default-deny branch in the hook, or both — is the design lap's call (objective; design Q2).

### 3.3 `drive` refuses to start a lap it cannot guard (Q7)

**The failure that just happened is the general case**: an SDK change moves what is consulted, the
guard is silently skipped, and the log still prints `Guard: path-jail…`. The product answer is a
hard stop, not a warning.

```
Refusing to start the product-review lap: the tool guard is not enforced by this SDK version
(CLAUDE_SDK_CAN_USE_TOOL_SHADOWED). No session was started and nothing was spent.
```

Three rules:

- **The SDK's shadow warning is promoted from log noise to a hard stop.** It was the one signal
  that told the truth here, and it scrolled past.
- **The `Guard:` line is printed only when the enforcement it describes is installed.** Otherwise
  the line is the refusal above. Same for `init`, whose wording no longer names `canUseTool`.
- **No `--unguarded` flag** (Q2 reasoning). The operator who wants an unguarded session already
  has one: `radio`, which says so.

"Nothing was spent" is part of the message on purpose — the operator's first question about any
refusal mid-pipeline is whether it cost them a lap.

### 3.4 No warn-only period (Q8)

The rules in `guard.ts` were unit-tested but never exercised by a live session. Once they run,
laps that have quietly been doing forbidden things start being denied mid-session. We do **not**
soften that with a warn-only mode:

- A warn-only guard *is* today's behaviour with extra log lines, and it would ship a second
  release whose documents promise enforcement that is not there.
- **The landing is softened before release, not after.** Each lap is run once for real against a
  throwaway task with the guard live, and the audit log is read. Every denial is either **correct**
  (the lap's prompt is fixed to stop asking for it) or a **wrong rule** (fixed as its own recorded
  decision, per the objective's "guardrails only tighten" constraint). This dry run is an
  **acceptance item** for Milestone 0, not a nice-to-have.
- **A lap that dies from a denial says so.** The operator sees the denial — tool, rule, path or
  command — in the session log and in `.vibe-racer/audit.log`. Never just "session ended".

### 3.5 Release and disclosure (Q9)

Milestone 0 **ships alone as a patch release** as soon as it passes its acceptance, ahead of
milestones 1–3.

| Surface | What it says |
|---|---|
| **CHANGELOG — Security** | 0.3.0 passed the guard as `canUseTool` while running sessions in `bypassPermissions`, where the SDK does not call it; the path jail, the review-stage Bash block, the command blocklist and the per-lap tool list were not enforced. Upgrade. |
| **`SECURITY.md`, `docs/security.md`** | Describe the hook mechanism, and carry **one dated line** recording that versions up to and including 0.3.0 did not enforce the guard. Not a footnote — an operator who raced a repository they do not control on 0.3.0 needs to know the agent had full permissions there. |
| **npm 0.3.0** | Deprecated with a one-line message pointing at the patch release, so `npm install` says it before the README does. |
| **Until the patch is out** | Anyone trying vibe-racer is told in words: treat a `drive` session as an unrestricted agent in the repo, and use the Docker recommendation. |
| **`docs/how-it-works.md`, `CLAUDE.md`, README** | Name the mechanism actually used. No surface may describe `canUseTool` as the enforcement point after this milestone. |

### 3.6 A test that would have caught it

`tests/claude/session.test.ts` mocks `query`, pulls `canUseTool` out of the options and invokes it
by hand — which proves the callback is *passed*, not that anything *calls* it. Milestone 0 adds, at
minimum:

- an assertion that the guard is registered under `hooks.PreToolUse` in the options `query`
  receives, failing if it is passed only as `canUseTool`;
- an assertion that a tool outside the lap's list is denied;
- treatment of `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` as a **test failure**, not log noise;
- a live-SDK check like the objective's three probes **if it can run without a paid session in
  CI**; if not, a documented manual check in the release steps.

---

## 4. Milestone 1 — Plans Never Ask For A Merge

### 4.1 Where the merge gate came from

The plan prompt teaches merge gates by example. Its gate categories open with "merging a
prerequisite PR"; `EXECUTION_TABLE_SPEC`'s worked example is
`| G1 | Operator merges PRs #12 and #14 | operator | pending | — | Unblocks M2 |`; `PAUSE_BLOCK_SPEC`'s
example checklist is "Open PRs against main in order #12 → #14 / Merge both PRs". The only merge
the prompt forbids is this task's *own* PR. A gate that merges someone else's work mid-table is
exactly what the prompt asks for — and it happened on a host project on 2026-09-24.

### 4.2 Prompt changes

| Surface | Change |
|---|---|
| Plan prompt, gate categories | "Merging a prerequisite PR" is removed. Remaining categories: code review, credentials or secrets, an external service or dashboard, a manual visual or screenshot check, a soak or wait period, anything outside the repository a following milestone needs |
| Plan prompt | Gains §2's principle in words, including the two legitimate dependency answers |
| `EXECUTION_TABLE_SPEC` worked example | Becomes a non-merge gate — a credential, a manual visual check, an external dashboard or a soak |
| `PAUSE_BLOCK_SPEC` worked example | Same. Stays fenced when interpolated (`CLAUDE.md`, *One markdown reader*) |
| Execute prompt | Keeps `git fetch`, `git merge-base` and `gh pr view` as read-only gate verification for the gates that remain, and keeps "you never push, open PRs, merge PRs or deploy" |
| QA prompt | The "Operator gates this task paused at" section and the mandatory coverage statement are deleted; `qaPrompt` no longer takes a gate list |

### 4.3 Plan review raises dependencies as questions

The `ai_plan_review` lap reads its own plan for dependencies on other branches, open PRs or
unmerged tasks, and raises **each one** as a question in `03_plan_questions.md` with the two
legitimate answers, so the operator decides at `need_plan`.

**Plan text only (Q3).** Repo probing — `gh pr list`, `git branch --contains`, sweeping
`vibe-racer/*` against `main` — is out of scope and goes to `plans/backlog.md` beside the
`depends_on` precondition it belongs with.

> A repo probe answers a question nobody asked. `gh pr list` returning three open PRs tells the
> plan lap nothing about whether *this* task depends on them, so it either stays silent (no value)
> or asks about all three (three questions to dismiss at every `need_plan`, on every task,
> forever). Noise at a pit stop is expensive — pit stops are where the operator's attention is
> spent, and a question they learn to skim is a question that stops working. (Q3)

**One narrow exception, because it is free and specific (Q3):** if the plan text names a branch or
PR *by identifier* (`vibe-racer/0004_…`, `#12`), plan review may run the read-only checks the guard
already allows (`gh pr view`, `git merge-base`) to state that dependency's **current status** in
the question — "PR #12 is still open" — so the operator decides with a fact rather than a memory.
It never goes looking for dependencies the plan did not name.

The plan lap also runs the forbidden-verb list (§4.4) over its **own** output before finishing, so
the common case is caught before the operator ever sees it. The sign-off refusal is the backstop,
not the first line of defence.

### 4.4 The forbidden-verb list — broad, with a cheap reword (Q1)

Optimised for **zero escapes**, not zero friction.

**Forbidden verbs:** `merge`, `push`, `open a PR` / `open PR` / `create a PR`, `close a PR`, `tag`,
`release`, `deploy`, `publish`, plus the command forms `git push`, `gh pr create`, `gh pr merge`,
`gh release`, `gh workflow run`.

All of them refuse, **including read-only phrasings**. A gate that wants to *verify* a tag or a
closed PR must say so with a **verification verb** — `confirm`, `check`, `verify`, `inspect` — and
that phrasing is what the prompt teaches.

> Rationale: the cost of a false positive is one reword by whoever wrote the row, and the message
> tells them the reword. The cost of an escape is a paid execute lap that sends the operator to
> `main` to merge unreviewed work — the exact failure that already happened on a host project.
> That asymmetry is not close. (Q1)

**Matching is deliberately a keyword check** (objective, *Decisions already made*). A hand-written
playbook goes through the same door as a generated one.

**Scan scope.** Live lines only — fence-aware and blockquote-aware through `markdown-scan.ts`, so a
quoted example in an agent's own playbook is inert here exactly as it is to the two table readers
(`CLAUDE.md`, *One markdown reader*):

- in `04_execute.md`: the `Name` and `Notes` cells of every `Owner = operator` row in the Execution
  Status table, and the bullets of the `## Operator gates in this plan` section;
- in `03_plan.md`: every `## G<n> — <name>` heading and its `- [ ]` checklist items.

**Out of scan scope:** rendered `## Operator actions — pause <n>` blocks. They are history of a
pause that already happened, not a declaration of future work, and the stage that reads them is
`need_operator`, not `need_execution`.

### 4.5 The sign-off refusal

`signOffPlaybook` already refuses the `need_execution` tick on a trailing operator row. It gains a
second blocking check with the same shape: name the row, untick the box, say why, and say what to
write instead.

```
G1 | Merge PR #12 | operator  asks for a merge. A task's cycle ends at `done`; the merge is
yours to do afterwards. If this task *needs* #12's work, that is a dependency — sequence this
task after it, or base this branch on it — and it belongs in `03_plan_questions.md`, not in the
playbook. If you only need to *check* #12's state, reword the row to "Confirm PR #12 is merged".
```

Three properties:

1. **The box is unticked** (`removeCompletionMarker`), so the task holds at `need_execution`. No
   lap starts, nothing is spent.
2. **Every refused row is named**, with its matched verb. Not "this plan contains a forbidden
   action".
3. **The message always carries the rewrite hint.** There is no override, so the message is the
   whole remedy (Q1, Q2).

**No override (Q2).** The operator's escape hatch is the text itself: edit the row, or delete the
gate and take the step by hand outside the pipeline. One line of editing, and it leaves a truthful
playbook behind. A `--force` would leave a playbook that says "merge PR #12" and a pipeline that
executed it — an artefact that lies about what happened, which is worse than the friction.

**Degradation.** If the Execution Status table cannot be parsed, the table half of the check warns
and allows, exactly as the trailing-row check already does — the box is ticked, and failing the
tick would strand the task at a stage whose checkbox says go. The `03_plan.md` `## G<n>` scan does
not depend on the table parse and still runs.

### 4.6 Doc changes

- `CLAUDE.md` gains §2's principle as a **Key decision**.
- `docs/how-it-works.md` drops "QA's diff scope shrinks after a gate" from known limitations.
- `docs/security.md` states that a plan cannot ask the operator to merge.

---

## 5. Milestone 2 — The Guard Enforces The No-Push Rule

*(formerly `0006_guard-enforces-the-no-push-rule`, unchanged in substance. Depends on Milestone 0:
a deny list added to a guard that is never called denies nothing.)*

### 5.1 The deny list

At `ready_to_execute`, Bash denies at minimum: `git push`, `gh pr create`, `gh pr merge`,
`gh release`, `gh workflow run`. Denials go through the same guard path as `BASH_BLOCKLIST` — the
`PreToolUse` hook after Milestone 0 — and are written to `.vibe-racer/audit.log` like every other
denial.

### 5.2 Hard requirement — the read-only allowances

`git fetch`, `gh pr view` and `gh pr list` **must stay allowed**. Gate verification runs exactly
these to confirm a gate cleared. A deny list that catches them breaks every plan with an operator
gate: the agent could never verify, and the fallback ladder would become the only path. **Tests
cover the allowances as explicitly as the denials.**

### 5.3 The denial message

Per Q2, the message names the command, the rule, and that this step is the operator's:

```
Denied: Bash 'git push -u origin HEAD' — vibe-racer never pushes. Pushing, opening PRs, merging,
tagging, releasing and deploying are the operator's, after the task reaches `done`.
```

### 5.4 Guard scope

`ready_to_execute` Bash only. `radio` stays prompt-only, before or after Milestone 0, and its
declaration in `SECURITY.md` / `docs/security.md` keeps saying so (objective, *Decisions already
made*).

### 5.5 Doc changes

`docs/security.md`, `SECURITY.md` and the README "Security" section move the no-push rule **out of
Known Limitations**, and the blocklist count all three state is updated together — they were
corrected to agree in #5 M8 and must keep agreeing with `guard.ts`.

---

## 6. Milestone 3 — `drive` Operates On The Task Branch

*(formerly `0008_drive-operates-on-the-task-branch`, unchanged in substance.)*

### 6.1 The problem

`drive` runs its advancement pass on whatever branch is checked out, reading every plan file from
the working tree as it is. From `main`, a paused task does not look paused, a ticked resume marker
is not seen, and a session that did start would commit to the wrong branch. #5 worked around it
(E17) by naming the task branch in every pause block and printing a branch hint. This milestone
makes the checkout the pipeline's job.

### 6.2 Dirty working tree — refuse, naming the paths (Q4)

```
Task #6 needs branch vibe-racer/0006_drive-enforcements, but you have uncommitted changes:
  M  src/claude/guard.ts
  ?? notes.md
Commit or stash them, then run `vibe-racer drive` again.
```

Why not the other two options the objective listed:

- **Stash-and-restore** is invisible custody of the operator's work. If the session errors, the
  process is killed, or a conflict blocks the pop, their changes are in a stash they did not create
  and will not think to look for. vibe-racer taking silent ownership of uncommitted human work is a
  trust violation out of all proportion to the convenience it buys.
- **Commit-on-branch** is worse: it puts unreviewed operator edits onto the task branch under a
  vibe-racer commit message, **inside the diff QA is about to review**. The `done` case stays as it
  is — there the only dirty files are the plan documents the pipeline itself produced and the
  checkbox the operator just ticked.

Refusal is also the only option free of surprise: the tree is exactly as the operator left it, and
the fix is two words they already know.

**Scope note the design lap must respect (Q4): the check is about *switching branches*.** If the
operator is already on the task branch, a dirty tree is not vibe-racer's business and `drive`
proceeds. Refusing there would break the common loop of editing a plan file and driving.

### 6.3 One task per `drive` (Q5)

```
Drove task #6. Also actionable: #7 (ready_to_execute), #9 (ai_qa).
Run `vibe-racer drive` again to take the next one, or `drive --task 7` to pick.
```

One checkout, one lap, one exit. Chaining laps across branches multiplies the ways a run can end
somewhere the operator did not expect: a mid-chain failure leaves them on an arbitrary task branch
with one lap done and one not, and `drive`'s output becomes a report on several tasks instead of on
the lap they asked for. `drive` already selects a single task; milestone 3 must not quietly turn it
into a batch runner — that is a different product decision and not this task's.

**The explicit "Also actionable" list is what makes this deliberate rather than arbitrary.** The
operator learns there is more work and how to reach it, in one line. Without it, "run drive again"
is folklore.

### 6.4 Where the operator is left — on the task branch (Q6)

**Leave them there. Do not restore.** The lap just wrote plan documents and possibly code onto that
branch, and their next action is always to read them — review a spec, tick a checkbox, inspect a
diff. Restoring `main` would bounce them away from the files `drive` just told them to open, and
every run would end with them typing the checkout by hand.

State it in the closing output, so it is a promise and not a side effect:

```
You are now on vibe-racer/0006_drive-enforcements.
Next: review plans/0006_drive-enforcements/01_product_questions.md and tick the checkbox.
```

### 6.5 Signposting verdicts (Q6)

| Signpost | Verdict |
|---|---|
| **`branchHint` in `drive`** (printed when nothing is actionable) | **Delete it.** Its whole job was explaining why a paused task looked idle from `main`. After milestone 3 that cannot happen, and a hint describing an impossible situation teaches the operator something false about how the tool works |
| **The pause block's closing line** — `When done, switch back to branch \`…\`, tick every box above and run \`vibe-racer drive\`.` | **Keep it, reworded, without the branch:** *"When done, tick every box above and run `vibe-racer drive`."* The branch name was the workaround; the instruction it wrapped is the one thing the operator must know at a pause and must survive. Dropping the branch also removes a stale-name hazard, since the block persists in the file |
| **The branch name where it is a fact rather than an instruction** — `finalizeTask`'s "Merge `vibe-racer/…` when ready", and §6.4's new closing line | **Keep.** The operator needs the name to merge; they no longer need it to drive |

`PAUSE_BLOCK_SPEC`, the pause-block renderer, its finder/normaliser and their tests move together —
the closing line is a line the spec dictates, the renderer writes and the finder locates.

---

## 7. Workflows & State Machine

### 7.1 No stage changes

`STAGE_ORDER`, `NON_LINEAR_STAGES` and the `need_operator` detour are untouched. `need_operator`
still lives outside `STAGE_ORDER` and still returns to `ready_to_execute`; `STAGE_QUESTIONS_FILE`
keeps its one unique `(file, markerText)` pair per stage, and `need_operator` keeps the resume
marker `Operator actions complete — resume execution` rather than a "Ready to advance…" line
(`CLAUDE.md`). This task changes **what refuses**, **where it is enforced**, and **which branch is
checked out** — not the shape of the machine.

### 7.2 `drive` run sequence after Milestone 3

The ordering matters, because today's pass advances *every* human-stage task from whatever tree is
checked out, and after milestone 3 a task's tick can only be read on its own branch.

```
1.  Prerequisite checks; load config; discover tasks
2.  Build the candidate set WITHOUT moving the working tree.
    A task is actionable if, read from its own branch:
      · it is at an agent stage, OR
      · it is at a human stage with its (file, markerText) ticked, OR
      · it is at `error` and `--retry` was given
    Tasks whose branch does not exist yet are read from the working tree (first `drive`)
3.  Select ONE task: `--task N` if given, else the first actionable in task-number order
4.  If the selected task's branch is not the current branch:
      · working tree dirty  -> REFUSE, name the paths, stop (§6.2)
      · clean               -> continue
    If it IS the current branch: proceed regardless of dirty state (§6.2 scope note)
5.  Check out (or create) the task branch
6.  Run the advancement pass for THAT TASK ONLY, on that branch
      · `need_execution` tick -> §4.5 sign-off checks; a refusal unticks and stops here
      · `need_operator` tick  -> resume, settling only the two statuses the pipeline wrote
      · `done`                -> finalizeTask: commit, "Merge … when ready"
7.  Dispatch the handler for the resulting stage
      · guarded session starts -> §7.3
8.  Closing output:
      · "You are now on <branch>."           (§6.4)
      · "Next: <file to read / box to tick>"  (§6.4)
      · "Also actionable: #7 …, #9 …"         (§6.3)
```

**Product requirement on step 2**: reading another task's tick must neither move the operator's
working tree nor require a clean one. The mechanism is the design lap's call (design Q5).

**Nothing actionable** → the existing "Waiting on operator" / "Waiting on human input" lists print,
now read from each task's own branch, and `branchHint` is gone (§6.5).

### 7.3 Guarded session startup after Milestone 0

```
handler asks for a session
        |
        v
resolve lap -> persona, skills, turn budget, tool list
        |
        v
install the guard as a PreToolUse hook + the lap's tool restriction
        |
   installed? ---- no ---> REFUSE the lap. Print §3.3. No session. Nothing spent
        | yes
        v
print the `Guard:` line  (printed ONLY here — it now describes installed enforcement)
        |
        v
run the session; every tool call -> the hook
        |
   allow -> tool runs
   deny  -> message to the model + `.vibe-racer/audit.log` + session log
        |
        v
a lap that ends because of a denial says "denied by the guard", never just "session ended" (§3.4)
```

### 7.4 The `need_execution` sign-off, after Milestone 1

```
operator ticks "Ready to advance to Execution" in 04_execute.md
        |
        v
parse the Execution Status table
        |
   unparsable ---> warn; table checks skipped; `03_plan.md` G-section scan still runs (§4.5)
        |
        v
CHECK A  trailing operator rows (existing)  -- hit --> untick, name rows, stop
        |
        v
CHECK B  forbidden verbs in gate rows / G-sections (§4.4) -- hit --> untick, name rows + verb,
        |                                                             print the rewrite hint, stop
        v
announce the gate count ("this plan contains N operator gates" / "no operator gates")
        |
        v
advance to ready_to_execute
```

Both checks are **status-blind** on purpose. Before execution, a `done` cell is the plan author
claiming something rather than the pipeline observing it; honouring it would make "mark the row
done" the way around a check whose whole job is keeping that work out of the table.

---

## 8. Configuration And Prerequisites

### 8.1 No new configuration

`.vibe-racer.yml` gains **no keys**. Explicitly rejected (Q2, Q7): an `allow:` list for the Bash
deny list, a per-task guard exemption, a warn-only guard mode, an `--unguarded` flag, a `--force`
on `drive`.

Existing keys are untouched: `repo`, `plans_dir`, `context`, `skills`, `max_turns`.

### 8.2 Prerequisites

| Prerequisite | Status |
|---|---|
| Node 20+, a git repository, an Anthropic API key or `claude login` | Unchanged |
| **An SDK that honours `PreToolUse` hooks under `bypassPermissions`** | **New.** Verified at session start; failure is the §3.3 refusal, not a crash and not a warning |
| `gh` on PATH | Still optional. Gate verification degrades to local refs when it is absent, as the execute prompt's fallback ladder already describes |
| `git` remote configured | Not required by anything this task adds. Nothing here contacts a remote except the read-only verification commands §5.2 preserves |
| **No new runtime dependencies** | Objective constraint. Build, lint and tests pass at every milestone; coverage only up |

### 8.3 Backward compatibility with in-flight tasks

- A playbook with a **non-merge** gate still signs off and executes unchanged.
- A playbook with a **merge** gate is refused with the row named — never silently skipped, never
  silently executed.
- A pause block already in a file keeps its old branch-naming closing line; only newly rendered
  blocks use the reworded one. The finder and normaliser must accept both so an in-flight pause
  still resumes.
- `qaPrompt` losing its gate parameter changes no on-disk artefact. Existing `05_qa.md` reports
  keep their coverage statements as history.

---

## 9. Edge Cases And Error Recovery

### 9.1 Milestone 0 — enforcement

| Situation | Behaviour |
|---|---|
| Guard cannot be installed (SDK change, unknown hook surface) | Refuse the lap, §3.3. No session, nothing spent |
| SDK emits `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` | Treated as the refusal condition, and as a **test failure** in CI |
| The guard's own decision function throws | Existing behaviour is preserved: deny, and audit it as `Internal guard error`. Fail closed |
| A denial ends a lap mid-session | The lap reports "denied by the guard" with tool, rule and path/command. Task goes to `error` with the stage recorded, so `drive --retry` can re-run it after the cause is fixed |
| A legitimate lap action is denied once the rules run for real | Found by the §3.4 pre-release dry run, not by the operator. Fixed either in the lap's prompt or as a recorded guard decision — never by loosening a rule in passing |
| A project or user settings file re-grants a tool the lap's list withholds | Must not be possible. Design question (design Q2); the outcome is asserted by a test either way |
| `.vibe-racer/audit.log` is unwritable | The denial still happens and is still logged to the session. Auditing must never be what decides whether a rule applies |

### 9.2 Milestone 1 — the merge ban

| Situation | Behaviour |
|---|---|
| Forbidden verb in an `Owner = agent` row | **Not** refused by the sign-off. Agent rows are the task's own work; the Bash deny list (§5.1) is what stops the agent acting on it, and the prompt is what stops it being written |
| Forbidden verb inside a fenced block or behind `> ` | Inert, via `markdown-scan.ts`. Same rule as both table readers |
| False positive — "Confirm the release tag `v0.3.0` exists on the remote" | Refused, by design (Q1). The message names the verb and the rewrite. One reword |
| A gate legitimately named "deploy config to the staging dashboard and screenshot it" | Refused. Reworded to a verification phrasing — "configure the staging dashboard and screenshot it" — in one edit |
| Operator deletes the gate row instead of rewording | Allowed and correct, provided the remaining table still satisfies the trailing-row rule. They take the step by hand, outside the pipeline |
| Operator re-ticks without changing anything | Refused again, identically. The check is deterministic and stateless |
| Execution Status table unparsable at sign-off | Table checks warn and skip; the `03_plan.md` G-section scan still runs; the tick is honoured (§4.5) |
| `03_plan.md` missing or unreadable | Warn and skip that half. A missing plan document never strands a ticked box |
| A plan genuinely depends on unmerged work | `ai_plan_review` raises one question per dependency in `03_plan_questions.md` with the two legitimate answers (§4.3) |
| An older playbook with a trailing merge gate reaches the execute loop | Unchanged from #5: the loop leaves the row exactly as it is — does not run it, mark it or pause on it — and completes into `ai_qa` |

### 9.3 Milestone 3 — the checkout

| Situation | Behaviour |
|---|---|
| Operator on `main`, task paused on its branch, tree clean | Checkout, read the tick, resume. **This is the E17 fix** |
| Operator on `main`, tree dirty, selected task is on another branch | Refuse, name the paths, stop (§6.2) |
| Operator already on the task branch, tree dirty | Proceed. A dirty tree on the task branch is not vibe-racer's business (§6.2 scope note) |
| Operator's dirty file *is* the ticked questions file, on `main` | Refused. The message names it; they commit or stash and re-drive. This is the transition cost of §6.2, and it is rare afterwards because `drive` now leaves them on the task branch (§6.4) |
| Task branch does not exist yet (first `drive`) | Created from the current HEAD, as today. The candidate set reads that task from the working tree (§7.2 step 2) |
| Checkout fails — conflict, locked index, detached HEAD, missing branch | Report the git error verbatim, name the branch, start no session. The operator's tree is left where it was |
| Two actionable tasks on different branches | Run the first, name the rest, stop (§6.3) |
| `--task N` names a task that is not actionable | Existing `ineligibleMessage` behaviour, unchanged, including the `need_operator` wording that says "paused waiting on the operator", never "error" |
| Lap errors after the checkout | The operator is left on the task branch with the error, which is where the evidence is. Say so in the error output |
| `drive` interrupted mid-lap (Ctrl-C, crash) | The operator is on the task branch and the tree is whatever the session left. No stash to recover, by construction (§6.2) |
| Repository has no `main` branch | Only the QA lap's diff scope depends on `main`, and its existing fallback (review every file named in `03_plan.md`'s milestones, and say which scope was used) is unchanged |

---

## 10. Scope Boundaries

### 10.1 In scope

- **M0**: guard registered where the SDK consults it; the lap tool list becomes a restriction; the
  `Guard:` and `init` lines print only when enforcement is installed; refuse-to-start when it is
  not; wiring tests; shadow warning as a failure; docs + CHANGELOG + npm deprecation.
- **M1**: plan-prompt gate categories and both worked examples lose every merge/push/PR verb; the
  principle stated in words; `ai_plan_review` dependency questions from plan text; the sign-off
  forbidden-verb refusal with named rows and a rewrite hint; `qaPrompt` loses its gate list and the
  coverage statement; `CLAUDE.md` / `docs/how-it-works.md` / `docs/security.md` updates.
- **M2**: `ready_to_execute` Bash deny list, with `git fetch` / `gh pr view` / `gh pr list`
  explicitly preserved and tested; audited denials with actionable messages; the no-push rule moves
  out of Known Limitations in all three documents and the blocklist counts stay in agreement.
- **M3**: checkout before the advancement pass; dirty-tree refusal; one task per run with the
  others named; leave the operator on the task branch and say so; `branchHint` deleted; the pause
  block's closing line reworded without the branch.

### 10.2 Out of scope

| Excluded | Why |
|---|---|
| **`depends_on`** (`new --after 0004`, `drive` refusing to start execution until the dependency is an ancestor of `main`) | The structural answer to sequencing, but a new feature with its own questions about `new` and `pitwall`. Already recorded in `plans/backlog.md` |
| **Repo probing for dependencies** (`gh pr list`, `git branch --contains` sweeps) | Q3. Noise at a pit stop. Goes to `plans/backlog.md` beside `depends_on` |
| **`radio`** | Spawns the operator's own interactive `claude` CLI, where the guard does not run — before or after M0. The declaration keeps saying so |
| **Leaving `bypassPermissions`** | Sessions are unattended by design. The fix is to enforce inside that mode, not to start prompting |
| **Any override** — `--force`, `allow:`, a magic comment, `--unguarded`, warn-only | Q2, Q7, Q8. A property with a switch is a default |
| **Follow-up #7's four questions** (which QA scope, where to record it, squash merges, the coverage statement) | Closed by construction. Dropped, not answered (§2.1) |
| **Other stages' Bash rules; when QA runs; pushing, pulling, rebasing or merging any branch from `drive`; creating the task branch** | Objective, *Out of scope*. Branch creation is already the first `drive`'s job |
| **Batch-driving several tasks in one run** | Q5. A different product decision |

### 10.3 Standing constraints

- **Guardrails only tighten.** Nothing here grants a tool, relaxes the path jail or lets an agent
  push. M0 changes *where* rules are enforced, not *what* they are; a rule that turns out to be
  wrong once it really runs is fixed as its own recorded decision.
- **`state.yml` stays pipeline-owned.** The agent signals through plan files only; stage changes go
  through `updateStage`.
- **One markdown reader.** Any change to `markdown-scan.ts` changes both readers at once and
  requires the four-playbook parse equivalence check
  (`plans/0005_infinite-loop-fix/05_qa_batch-b.md` §6).
- **No new runtime dependencies.** Build, lint, typecheck and tests pass at every milestone.

---

## 11. Acceptance Criteria

### AC0 — Enforcement that actually runs *(ships alone, as a patch release)*

| ID | Criterion |
|---|---|
| AC0.1 | In a real session under `bypassPermissions`, a `Write` outside the plan folder at a review stage is **denied** and appears in `.vibe-racer/audit.log` |
| AC0.2 | In a real session, `Bash` at a review stage is denied |
| AC0.3 | In a real session at `ready_to_execute`, a `BASH_BLOCKLIST` command is denied |
| AC0.4 | A tool outside the lap's list is denied, or absent from the session's tool list |
| AC0.5 | No session emits `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`; CI fails if one does |
| AC0.6 | A wiring test fails if the guard is passed only as `canUseTool` |
| AC0.7 | When enforcement cannot be installed, `drive` prints §3.3 and starts **no** session |
| AC0.8 | The `Guard:` line and `init`'s security line print only when the enforcement they describe is installed, and `init`'s wording does not name `canUseTool` |
| AC0.9 | Every lap has been run once for real against a throwaway task with the guard live, and its audit log read; each denial is recorded as correct-and-prompt-fixed or wrong-and-rule-fixed (§3.4) |
| AC0.10 | `SECURITY.md`, `docs/security.md`, `docs/how-it-works.md`, `CLAUDE.md` and the README name the hook mechanism; the two security documents carry the dated 0.3.0 line; the CHANGELOG has the Security entry; npm 0.3.0 is deprecated with a pointer to the patch |

### AC1 — Plans never ask for a merge

| ID | Criterion |
|---|---|
| AC1.1 | A plan lap run against a task that depends on an unmerged branch produces a **plan question**, not a gate row |
| AC1.2 | A hand-written playbook with `G1 \| Merge PR #12 \| operator \| pending` followed by `M1` has its sign-off tick **refused with the row named**, the box unticked, and the rewrite hint printed |
| AC1.3 | A test asserts that `EXECUTION_TABLE_SPEC`, `PAUSE_BLOCK_SPEC` and the rendered plan and execute prompts contain **no** merge, push or PR verb in any gate example |
| AC1.4 | Each forbidden verb in §4.4's list is refused, and each verification phrasing (`confirm`, `check`, `verify`, `inspect` + the same noun) passes — tested as explicitly as the denials |
| AC1.5 | A forbidden verb inside a fence or behind `> ` does **not** refuse |
| AC1.6 | A forbidden verb in an `Owner = agent` row does not refuse the sign-off |
| AC1.7 | An unparsable table warns and honours the tick; the `03_plan.md` G-section scan still runs |
| AC1.8 | `qaPrompt` takes no gate list; no rendered QA prompt contains the coverage statement or the "Operator gates this task paused at" section |
| AC1.9 | A playbook with a non-merge gate signs off and executes exactly as before (backward compatibility) |
| AC1.10 | `CLAUDE.md` carries the principle as a Key decision; `docs/how-it-works.md` no longer lists "QA's diff scope shrinks after a gate" |

### AC2 — The guard enforces the no-push rule

| ID | Criterion |
|---|---|
| AC2.1 | From a `ready_to_execute` session, each of `git push`, `gh pr create`, `gh pr merge`, `gh release`, `gh workflow run` is refused and audited |
| AC2.2 | From the same session, `git fetch`, `gh pr view` and `gh pr list` **pass** |
| AC2.3 | Each denial message names the command, the rule and that the step is the operator's |
| AC2.4 | `docs/security.md`, `SECURITY.md` and the README agree with `guard.ts` on the rule set and the blocklist count, and none lists the no-push rule under Known Limitations |

### AC3 — `drive` operates on the task branch

| ID | Criterion |
|---|---|
| AC3.1 | With a task paused on `vibe-racer/NNNN_slug` and the operator on `main`, `drive` finds the ticked resume marker and resumes |
| AC3.2 | A session started by `drive` commits to the task branch whatever branch was checked out beforehand |
| AC3.3 | A dirty tree plus a required branch switch produces the §6.2 refusal, with the dirty paths named, and starts no session |
| AC3.4 | A dirty tree while already on the task branch does **not** refuse |
| AC3.5 | With two actionable tasks on different branches, exactly one lap runs and the others are named in the "Also actionable" line |
| AC3.6 | `drive` ends on the task branch and says so, with the operator's next action named |
| AC3.7 | `branchHint` is gone; the pause block's closing line no longer names a branch, and a pause block written before this change still resumes |
| AC3.8 | Both policy decisions (dirty tree, multiple tasks) are written into `02_design.md` **with their reasoning** |

---

## 12. Open Questions Handed To The Design Lap

Answered here, closed: the verb list and its false positives (Q1), overrides (Q2), dependency
detection depth (Q3), dirty tree (Q4), multiple tasks (Q5), final branch and signposting (Q6),
refuse-to-start (Q7), warn-only (Q8), release and disclosure (Q9).

Deliberately left to design, as the objective says:

1. **How Layer 1 becomes a restriction** — removing the tool from the model's context, a
   default-deny branch in the hook, or both; and whether `settingSources: ["project", "user"]`
   lets a settings file re-grant what the lap's list withholds (objective open question 5).
2. **How "enforcement is installed" is detected** — so that §3.3's refusal is a fact about this
   SDK rather than a version string we hope matches.
3. **How a task's tick is read from its own branch without moving the working tree** (§7.2
   step 2).
4. **Where the forbidden-verb list lives** so the sign-off, the plan prompt and the prompt-spec
   tests share exactly one copy of it.

These are carried into `02_design_questions.md` as Q1, Q3, Q5 and Q4 respectively.
