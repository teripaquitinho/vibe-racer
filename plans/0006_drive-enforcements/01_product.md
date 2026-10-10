# Product Specification for #6: drive-enforcements

> **Role**: Senior Product Designer
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-10-10
> **Sources**: `00_objective.md` (milestones 1–3, decisions already made) and
> `01_product_questions.md` (Q1–Q9, answered). Every decision below cites the Q&A it comes from.
> **Revised 2026-10-10** after the operator's review: the guard fix (formerly Milestone 0, Q7–Q9)
> is now a prerequisite task of its own, and §4.4's verification-verb rule is stated once.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [The Principle, Stated Once](#2-the-principle-stated-once)
3. [Prerequisite — Enforcement That Actually Runs](#3-prerequisite--enforcement-that-actually-runs)
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

Three changes that make one sentence true: **git belongs to the operator, and a task's cycle
belongs to its branch.**

| # | Milestone | What the operator gets |
|---|---|---|
| **1** | Plans never ask for a merge | No plan can send them to `main` mid-execution to merge unreviewed work |
| **2** | The guard enforces the no-push rule | `git push`, `gh pr create`, `gh pr merge`, `gh release` and `gh workflow run` are denied by the guard, not just discouraged by a prompt |
| **3** | `drive` operates on the task branch | `drive` works from any branch; a paused task is never invisible |

### 1.2 What this task stands on

Found 2026-10-10: the tool guard is passed as `canUseTool` while every session runs in
`permissionMode: "bypassPermissions"`, where the installed SDK does not consult it, and
`allowedTools` does not restrict. Milestone 2 adds a rule to that guard, so nothing it promises is
true until the guard runs.

Making it run is **not part of this task**. It is a prerequisite task of its own that races,
merges and is released first (§3). The order here is **1, then 2, then 3** (objective, *Decisions
already made*).

### 1.3 Who this is for

The **operator** — one human running vibe-racer on their own repository, usually alone, usually
unattended while a lap runs. Three things they care about here:

1. **They own git.** Nothing is pushed, merged, tagged, released or deployed by the agent, ever.
2. **They own their working tree.** vibe-racer never takes silent custody of uncommitted work.
3. **The claims the tool prints are true.** A security banner that prints unconditionally is
   decoration (Q7).

### 1.4 Product posture: guardrails have no switches

Both new guardrails — the sign-off refusal and the Bash deny list — are absolute. No `--force`, no
`allow:` key in `.vibe-racer.yml`, no magic comment (Q2).

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

## 3. Prerequisite — Enforcement That Actually Runs

*(formerly Milestone 0 of this task; its sections 3.1–3.6, the answers to Q7–Q9, AC0 and the
guarded-startup workflow have moved with it)*

This is a **separate task**, raced and merged before this one executes. It was written here as a
milestone that "ships alone as a patch release", and that cannot be done from inside this task:

- The task has one branch and one cycle, and QA runs after all milestones. Releasing the guard fix
  ahead of the rest needs a merge mid-cycle — what Milestone 1 forbids.
- `main` already carries #5's unreleased work, so a release cut from `main` is not a patch of
  0.3.0 in any case.

It is the dependency §2 describes, answered with **Sequence**.

**What this task requires of it** — checked at the top of the plan lap, not assumed:

| Requirement | Used by |
|---|---|
| The guard's rules run from a `PreToolUse` hook on every tool call under `bypassPermissions` | §5.1 — the deny list is a rule in that guard |
| Denials are written to `.vibe-racer/audit.log` | AC2.1 |
| A tool outside the lap's list is denied | §4.3 — plan review has no Bash, which is why the handler, not the agent, checks a named dependency's status |

If any of the three does not hold on `main` when this task reaches `need_plan`, that is a plan
question, not something to fix in passing here.

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

**One narrow exception, because it is free and specific (Q3):** if the task's documents name a
branch or PR *by identifier* (`vibe-racer/0004_…`, `PR #12` — a bare `#12` is not enough, since
`#N` also names tasks and issues), the question states that dependency's
**current status** — "PR #12 is still open" — so the operator decides with a fact rather than a
memory. Nothing goes looking for dependencies the documents did not name.

**The handler runs that check, not the agent (operator decision, 2026-10-10).** Q3 was written as
"plan review may run the read-only checks the guard already allows", and it cannot: a review lap
has `Read, Glob, Grep, Write` and the guard denies Bash at all four review stages. It only looked
possible while the guard was not running. Granting Bash to plan review would loosen a rule, which
the standing constraint forbids. So before the session starts, the plan-review handler collects the
identifiers named in the task's documents, runs the read-only checks itself (`gh pr view`,
`git merge-base`), and hands the session a short status list in its prompt. The session never
touches the remote.

- If a check cannot run (no `gh`, no network, not a PR, no answer within a few seconds), the
  status is "unknown" and says why. A failed or slow check never fails or stalls the lap.
- `gh pr view` is a network call `drive` makes outside a session. That is accepted and said here
  rather than discovered: it is read-only, bounded by a timeout, and skipped when `gh` is absent.
- The check reads the documents that exist **before** the session. A dependency the session names
  for the first time in the plan it is writing gets a question without a status attached.
- Only **state** reaches the prompt — open, merged, closed, ancestor of `main` or not. PR titles
  and bodies are someone else's text and stay out of it.

**The handler also runs the forbidden-verb check (§4.4) over the plan lap's output**, after the
session ends — the session cannot run code, so "the plan lap checks its own output" could only
ever have been a sentence in a prompt. A hit is printed as a warning naming the row and the
reword, at the moment the operator is about to read the plan; it does not fail the lap. The
sign-off refusal (§4.5) stays the thing that blocks.

### 4.4 The forbidden-verb list — broad, with a cheap reword (Q1)

Optimised for **zero escapes**, not zero friction.

**Forbidden verbs:** `merge`, `push`, `open a PR` / `open PR` / `create a PR`, `close a PR`, `tag`,
`release`, `deploy`, `publish`, plus the command forms `git push`, `gh pr create`, `gh pr merge`,
`gh release`, `gh workflow run`.

**One exemption, and it is positional.** A gate may *verify* state — a tag that exists, a PR that
is closed — if it says so with a **verification verb**: `confirm`, `check`, `verify`, `inspect`.
The rule, stated once and tested as stated (AC1.4):

- A line is read clause by clause (split on `,` `;` `→`, a spaced ` / `, `then`, `and`; a `/`
  inside a path or ref is not a separator).
- A clause containing a forbidden verb passes **only if the clause begins with a verification
  verb**. A verification verb elsewhere on the line exempts nothing:
  `Confirm the build, then merge PR #12` is refused.
- A clause containing a **command form** (`git push`, `gh pr merge`, …) is never exempt.

Everything else refuses, including phrasings the author meant innocently (`Tag the screenshot with
the build number`). That is the false positive this list accepts.

Verbs match **whole words and their inflections, never substrings**: `tag` and `tagged` match,
`staging`, `stage` and `package` do not. The read-only commands gate verification uses —
`git merge-base`, `git fetch`, `gh pr view`, `gh pr list` — are not verb matches either:
`git merge-base --is-ancestor …` in a checklist item is a verification command, not a merge.

**What the exemption does not make acceptable.** `Verify PR #12 is merged` passes the check, and
as a gate it is still a dependency on unmerged work: at the pause the operator goes and merges. A
keyword check cannot tell state that already holds from state someone is waiting for. That case
belongs to the plan-review dependency question (§4.3), and the refusal message must not teach it
(§4.5).

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
playbook. A gate may still check state that already exists if the row begins with a verification
verb, e.g. "Confirm tag v0.3.0 exists on the remote".
```

The hint's example is deliberately **not** the refused PR. Offering "Confirm PR #12 is merged"
would hand back the same dependency in a phrasing the check accepts (§4.4).

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

*(formerly `0006_guard-enforces-the-no-push-rule`, unchanged in substance. Depends on the
prerequisite task (§3): a deny list added to a guard that is never called denies nothing.)*

### 5.1 The deny list

At `ready_to_execute`, Bash denies at minimum: `git push`, `gh pr create`, `gh pr merge`,
`gh release`, `gh workflow run`. Denials go through the same guard path as `BASH_BLOCKLIST` — the
`PreToolUse` hook the prerequisite task installs — and are written to `.vibe-racer/audit.log` like every other
denial.

### 5.2 Hard requirement — the read-only allowances

`git fetch`, `gh pr view` and `gh pr list` **must stay allowed**. Gate verification runs exactly
these to confirm a gate cleared. A deny list that catches them breaks every plan with an operator
gate: the agent could never verify, and the fallback ladder would become the only path. **Tests
cover the allowances as explicitly as the denials.**

### 5.3 The denial message

Per Q2, the message names the command, the rule, and that this step is the operator's:

```
Denied: Bash 'git push -u origin HEAD' — `git push` is denied in an execute session. Pushing,
opening PRs, merging, tagging, releasing and deploying are the operator's, after the task reaches
`done`.
```

### 5.4 Guard scope

**`gh` is not denied; five commands are (operator decision, 2026-10-10).** `gh` and `git` stay
usable from an execute session — gate verification depends on them (§5.2). The stated consequence:
`gh api` can still write to the remote, so the claim this milestone supports is "the guard denies
`git push`, `gh pr create`, `gh pr merge`, `gh release` and `gh workflow run`", not "vibe-racer
cannot push". The three security documents use the first wording and keep two residuals under
Known Limitations: `gh api`, and a command hidden inside another shell (`sh -c "git push"`,
`eval`, a script), which the guard reads as an argument and does not look into.

`ready_to_execute` Bash only. `radio` stays prompt-only, before or after the prerequisite task, and its
declaration in `SECURITY.md` / `docs/security.md` keeps saying so (objective, *Decisions already
made*).

### 5.5 Doc changes

`docs/security.md`, `SECURITY.md` and the README "Security" section list the deny list **as a
rule**, naming its five commands. Under Known Limitations the entry "vibe-racer never pushes is a
prompt rule only" is replaced — not deleted — by the two residuals of §5.4. The blocklist count all three state is updated together — they were
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
    Tasks at `need_objective` with no local branch and no remote-tracking ref are read from
    the working tree (first `drive`). A task whose branch exists only as `origin/…` is read
    from that ref.
    A tick that exists only as an uncommitted edit in the working tree, for a task whose
    branch is elsewhere, still makes the task a candidate — so step 4 can refuse and name it
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
      · the session is guarded by the hook the prerequisite task installs (§3)
8.  Closing output:
      · "You are now on <branch>."           (§6.4)
      · "Next: <file to read / box to tick>"  (§6.4)
      · "Also actionable: #7 …, #9 …"         (§6.3)
```

**Product requirement on step 2**: reading another task's tick must neither move the operator's
working tree nor require a clean one. The mechanism is the design lap's call (design Q5).

**Nothing actionable** → the existing "Waiting on operator" / "Waiting on human input" lists print,
now read from each task's own branch, and `branchHint` is gone (§6.5).

### 7.3 *(moved)*

Guarded session startup belongs to the prerequisite task (§3). The number is kept so the
references to §7.2 and §7.4 elsewhere stay valid.

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

`.vibe-racer.yml` gains **no keys**. Explicitly rejected (Q2): an `allow:` list for the Bash
deny list, a per-task guard exemption, a `--force` on `drive`.

Existing keys are untouched: `repo`, `plans_dir`, `context`, `skills`, `max_turns`.

### 8.2 Prerequisites

| Prerequisite | Status |
|---|---|
| Node 20+, a git repository, an Anthropic API key or `claude login` | Unchanged |
| **The prerequisite task merged into `main`, and this branch rebuilt on it** | **New.** §3. Checked at the top of the plan lap |
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

### 9.1 *(moved)*

The enforcement edge cases belong to the prerequisite task (§3).

### 9.2 Milestone 1 — the merge ban

| Situation | Behaviour |
|---|---|
| Forbidden verb in an `Owner = agent` row | **Not** refused by the sign-off. Agent rows are the task's own work; the Bash deny list (§5.1) is what stops the agent acting on it, and the prompt is what stops it being written |
| Forbidden verb inside a fenced block or behind `> ` | Inert, via `markdown-scan.ts`. Same rule as both table readers |
| "Confirm the release tag `v0.3.0` exists on the remote" | **Passes.** The clause begins with a verification verb (§4.4) |
| "Confirm the build, then merge PR #12" | Refused. The second clause does not begin with a verification verb; a verification verb elsewhere on the line exempts nothing |
| False positive — "Tag the screenshot with the build number" | Refused, by design (Q1). The message names the verb and the rewrite. One reword ("Label the screenshot …") |
| A gate legitimately named "deploy config to the staging dashboard and screenshot it" | Refused. Reworded **without the forbidden verb** — "configure the staging dashboard and screenshot it" — in one edit. That is a reword, not a verification phrasing |
| "Verify PR #12 is merged" on a PR this task depends on | Passes the keyword check — the accepted residual of §4.4. Caught, if at all, by the plan-review dependency question (§4.3) |
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
| Operator's dirty file *is* the ticked questions file, on `main` | Refused. The message names it; they commit or stash and re-drive. **The candidate set must therefore see this tick** even though the task is otherwise read from its branch (§7.2 step 2) — otherwise the outcome is a silent "nothing to do". This is the transition cost of §6.2, and it is rare afterwards because `drive` now leaves them on the task branch (§6.4) |
| Task branch exists only as a remote-tracking ref (`origin/vibe-racer/NNNN_slug` — a fresh clone, or a local branch deleted after a push) | **Not** a first `drive`, whatever `state.yml` says on the current branch: on `main` it says `need_objective` for the whole life of the task. `drive` reads the task from that ref and creates the local branch **from it**, saying so. A local read of refs already fetched; no network |
| Task branch exists on the remote but was never fetched | Indistinguishable from a first `drive` without a network call, and `drive` makes none here. Stated limit: `git fetch` before `drive` on a clone that may be behind |
| Task branch is missing locally and on every remote-tracking ref, and `state.yml` is past `need_objective` (deleted after its merge) | **Not** treated as a first `drive`. The task is read from the working tree, and `drive` refuses to create the branch silently — it names the missing branch and how to recreate it. Creating it from the current HEAD would cut it from another task's work |
| No local branch, no remote-tracking ref, and `state.yml` says `need_objective` (first `drive`) | Created from the current HEAD, as today. The stage is the signal, not the folder's contents — an extra file dropped beside the objective changes nothing. The candidate set reads that task from the working tree (§7.2 step 2) |
| Checkout fails — conflict, locked index, detached HEAD, missing branch | Report the git error verbatim, name the branch, start no session. The operator's tree is left where it was |
| Two actionable tasks on different branches | Run the first, name the rest, stop (§6.3) |
| `--task N` names a task that is not actionable | Existing `ineligibleMessage` behaviour, unchanged, including the `need_operator` wording that says "paused waiting on the operator", never "error" |
| Lap errors after the checkout | The operator is left on the task branch with the error, which is where the evidence is. Say so in the error output |
| `drive` interrupted mid-lap (Ctrl-C, crash) | The operator is on the task branch and the tree is whatever the session left. No stash to recover, by construction (§6.2) |
| Repository has no `main` branch | Only the QA lap's diff scope depends on `main`, and its existing fallback (review every file named in `03_plan.md`'s milestones, and say which scope was used) is unchanged |

---

## 10. Scope Boundaries

### 10.1 In scope

- **M1**: plan-prompt gate categories and both worked examples lose every merge/push/PR verb; the
  principle stated in words; `ai_plan_review` dependency questions from plan text; the sign-off
  forbidden-verb refusal with named rows and a rewrite hint; `qaPrompt` loses its gate list and the
  coverage statement; `CLAUDE.md` / `docs/how-it-works.md` / `docs/security.md` updates.
- **M2**: `ready_to_execute` Bash deny list, with `git fetch` / `gh pr view` / `gh pr list`
  explicitly preserved and tested; audited denials with actionable messages; the deny list is
  documented as a rule in all three documents, with `gh api` and nested shells as its stated
  residuals, and the blocklist counts stay in agreement.
- **M3**: checkout before the advancement pass; dirty-tree refusal; one task per run with the
  others named; leave the operator on the task branch and say so; `branchHint` deleted; the pause
  block's closing line reworded without the branch.

### 10.2 Out of scope

| Excluded | Why |
|---|---|
| **`depends_on`** (`new --after 0004`, `drive` refusing to start execution until the dependency is an ancestor of `main`) | The structural answer to sequencing, but a new feature with its own questions about `new` and `pitwall`. Already recorded in `plans/backlog.md` |
| **Repo probing for dependencies** (`gh pr list`, `git branch --contains` sweeps) | Q3. Noise at a pit stop. Goes to `plans/backlog.md` beside `depends_on` |
| **Making the guard run** (hook transport, the lap tool list as a restriction, refuse-to-start, the 0.3.0 disclosure and release) | The prerequisite task (§3). Sequenced before this one |
| **`radio`** | Spawns the operator's own interactive `claude` CLI, where the guard does not run — before or after the prerequisite task. The declaration keeps saying so |
| **Leaving `bypassPermissions`** | Sessions are unattended by design. The fix is to enforce inside that mode, not to start prompting |
| **Any override** — `--force`, `allow:`, a magic comment | Q2. A property with a switch is a default |
| **Follow-up #7's four questions** (which QA scope, where to record it, squash merges, the coverage statement) | Closed by construction. Dropped, not answered (§2.1) |
| **Other stages' Bash rules; when QA runs; pushing, pulling, rebasing or merging any branch from `drive`; creating the task branch** | Objective, *Out of scope*. Branch creation is already the first `drive`'s job |
| **Batch-driving several tasks in one run** | Q5. A different product decision |

### 10.3 Standing constraints

- **Guardrails only tighten.** Nothing here grants a tool, relaxes the path jail or lets an agent
  push. A rule that turns out to be wrong once it really runs is fixed as its own recorded
  decision.
- **`state.yml` stays pipeline-owned.** The agent signals through plan files only; stage changes go
  through `updateStage`.
- **One markdown reader.** Any change to `markdown-scan.ts` changes both readers at once and
  requires the four-playbook parse equivalence check
  (`plans/0005_infinite-loop-fix/05_qa_batch-b.md` §6).
- **No new runtime dependencies.** Build, lint, typecheck and tests pass at every milestone.

---

## 11. Acceptance Criteria

### AC0 — *(moved)*

AC0.1–AC0.10 belong to the prerequisite task (§3). One criterion remains here:

| ID | Criterion |
|---|---|
| AC0.1 | Before the plan lap writes a plan, the three requirements in §3 are confirmed to hold on `main`; if one does not, it is raised as a plan question |

### AC1 — Plans never ask for a merge

| ID | Criterion |
|---|---|
| AC1.1 | A plan lap run against a task that depends on an unmerged branch produces a **plan question**, not a gate row |
| AC1.2 | A hand-written playbook with `G1 \| Merge PR #12 \| operator \| pending` followed by `M1` has its sign-off tick **refused with the row named**, the box unticked, and the rewrite hint printed |
| AC1.3 | A test asserts that `EXECUTION_TABLE_SPEC`, `PAUSE_BLOCK_SPEC` and the rendered plan and execute prompts contain **no** merge, push or PR verb in any gate example |
| AC1.4 | Each forbidden verb in §4.4's list is refused; each clause that **begins** with a verification verb (`confirm`, `check`, `verify`, `inspect`) passes; a line with a verification verb in one clause and a forbidden verb in another (`Confirm the build, then merge PR #12`) is refused; a command form is refused whatever precedes it — all tested as explicitly as the denials |
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
| AC2.4 | `docs/security.md`, `SECURITY.md` and the README agree with `guard.ts` on the rule set and the blocklist count, the deny list is stated as a rule naming its five commands, and `gh api` and nested shells (`sh -c`) are listed as its residual limitations. None of the three says "cannot push" |

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
detection depth (Q3), dirty tree (Q4), multiple tasks (Q5), final branch and signposting (Q6).
Q7–Q9 (refuse-to-start, warn-only, release and disclosure) travel with the prerequisite task; Q9's
"ships alone as a patch" is withdrawn.

Deliberately left to design, as the objective says:

1. **Where the forbidden-verb list lives**, and how a verification verb exempts a clause, so the
   sign-off, the plan prompt and the prompt-spec tests share exactly one copy of the rule.
2. **Where the five denied commands live** so the plan check and the guard rule cannot drift.
3. **How a task's tick is read from its own branch without moving the working tree** (§7.2
   step 2), including the uncommitted-tick and missing-branch cases of §9.3.

4. **How the plan-review handler finds named identifiers and reports their status** to the
   session (§4.3).

These are carried into `02_design_questions.md` as Q1, Q2, Q3 and Q4 respectively.
