# How It Works

## Architecture Overview

vibe-racer is a standalone CLI that orchestrates Claude Code SDK sessions against local task folders. It does not modify your project's dependencies or require any runtime integration.

```
vibe-racer CLI
  |
  +-- State Machine (state.yml per task)
  |     |
  |     +-- Pit stop stages: wait for checkbox
  |     +-- Race engineer stages: run Claude Code session
  |
  +-- Claude Code SDK
  |     |
  |     +-- Persona (append to system prompt)
  |     +-- Tool guard (canUseTool callback)
  |     +-- Streaming output
  |
  +-- Git (simple-git)
        |
        +-- Branch per task
        +-- Commit per lap/milestone
        +-- Pre-commit secret scan
```

## State Machine

Each task has a `state.yml` file tracking its current stage. The state machine is linear:

```
need_objective -> ai_objective_review -> need_product -> ai_product_review ->
need_design -> ai_design_review -> need_plan -> ai_plan_review ->
need_execution -> ready_to_execute -> ai_qa -> fine_tuning ->
cleanup_ready -> need_decision -> done
```

- **Pit stops** (`need_*`, plus `fine_tuning`): Write content, review answers, tick checkbox.
- **Race engineer phases** (`ai_*`, plus `ready_to_execute` and `cleanup_ready`): Claude Code session runs automatically.
- **`error`**: Entered on race engineer failure. The failing stage is recorded in `error_stage`; `--retry` restores it and dispatches that handler again.
- **`need_operator`**: A pit stop **outside** the linear sequence — a detour the execution lap takes when a milestone needs you, and which always returns to `ready_to_execute`. `state.yml` records `paused_stage`, `operator_milestone` and a one-line `operator_reason`; `prev` and `next` both point back at the paused stage. It is not an error: nothing broke, the pipeline is waiting on a person. `--retry` does not touch it. See [Execution Loop](#execution-loop).

The `prev` and `next` fields in `state.yml` are auto-computed on write for navigation.

`state.yml` is pipeline-owned. Guard Rule 0 denies `Write` and `Edit` to any `state.yml`
under `plans_dir` at every stage, so a session can never advance itself or hand-author a
stage name. Every transition goes through `updateStage`, which validates against the enum.

## Claude Code Sessions

Each race engineer phase runs a Claude Code SDK session with:

- **Preset**: `claude_code` -- gives the race engineer file editing, git, and codebase understanding capabilities
- **Persona**: Appended to the system prompt via the `append` field. Different persona per lap:
  - **Senior Product Designer** for objective and product review
  - **Software Architect** for design review
  - **Software Engineer** for plan review and execution
  - **Senior QA Engineer** for the QA lap
  - **Release Manager** for the decision checklist
- **Context files**: Loaded from the `context` array in `.vibe-racer.yml` (default: README.md, CLAUDE.md)
- **Streaming**: Output is streamed to the terminal in real-time
- **Guard**: `canUseTool` callback enforces security rules on every tool invocation
- **Skills**: Each agent stage maps to a lap (`LAP_BY_STAGE`), and each lap resolves to a list of Claude Code skills. Installed skills are probed once per session; missing names warn and are skipped, and a failed probe degrades to persona-only rather than failing the lap. See [Configuration](/configuration#skills).

## Advancement Logic

When you run `vibe-racer drive`, the following happens:

1. **Scan for ticked checkboxes**: All pit-stop tasks are checked for `- [x] Ready to advance to ...`
2. **Validate answers**: If the file has `**Answer:**` sections, all must be filled in (not blank)
3. **Advance**: If checkbox is ticked and answers are complete, the task advances to the next lap
4. **Enforce the decision checklist**: At `need_decision`, any remaining `- [ ]` in `06_decision.md` blocks advancement — the unworked lines are printed and the completion checkbox is unticked
5. **Find actionable tasks**: Tasks at race engineer phases are eligible for processing
6. **Dispatch**: The correct handler runs based on the current stage

Advancement is keyed on one `(file, marker)` pair per stage: `00_objective.md`,
`01_product_questions.md`, `02_design_questions.md`, `03_plan_questions.md`, `04_execute.md`,
`05_qa.md`, `06_decision.md`, each with its own "Ready to advance to …" checkbox. No two stages
share a pair — a stale tick left in an earlier lap's document cannot advance a later one. The one
file read by two stages is `04_execute.md`: `need_execution` ticks "Ready to advance to
Execution", while a paused task at `need_operator` resumes on a different marker, "Operator
actions complete — resume execution", read from the **last** pause block only. The sign-off tick
still sitting in that file can never resume a pause.

Two more things happen at the `need_execution` sign-off. `drive` prints the operator gates the
plan declared (or says there are none), so the person ticking the box sees what they owe. And it
refuses the tick when the Execution Status table ends in an operator-owned row with no milestone
after it: merging, tagging, releasing and deploying the task's own work are not execution
milestones, and a plan that lists them as rows could never finish executing. The rows are named,
the box is unticked, and you delete them and tick again.

## Follow-up Detection

After a race engineer session, vibe-racer checks whether the race engineer needs more information:

1. If the race engineer appended follow-up questions to the questions file
2. And unchecked the completion checkbox
3. Then the task stays at the current pit stop instead of advancing

This allows up to 3 rounds of follow-up questions (5-6 questions per round). After 3 rounds, the race engineer proceeds with available information.

## Git Branching

Each task gets its own branch:

```
vibe-racer/0001_add-user-authentication
vibe-racer/0002_fix-login-bug
```

- Branches are created automatically when a task is first processed
- Commits happen after each lap completion and each execution milestone
- `commitAll()` is idempotent -- returns empty string when nothing is staged
- Pre-commit secret scanning runs on every commit

vibe-racer never pushes to remote. You control when to push and create PRs.

## Prompt System

The prompt templates are built-in and combine:

1. **Instructions**: Lap-specific instructions (what to analyze, what to produce)
2. **Context**: Project files from the `context` array
3. **Prior artifacts**: Previously generated documents from earlier laps
4. **Persona**: Role-specific behavior (appended to system prompt)

Each prompt is designed to produce structured markdown output that can be committed directly as a plan document.

## Execution Loop

The execution lap (`ready_to_execute`) is driven by one table: the **Execution Status** table in
`04_execute.md`, the first pipe table under a heading containing "Execution Status" that has both
a `Milestone` and a `Status` column. Nothing else in the file is read — prose, the milestone
summary table and notes elsewhere are inert. The plan lap writes it; `src/pipeline/execute-table.ts`
parses it; the handler in `src/pipeline/handlers/execute.ts` runs it.

| Column | Meaning |
|---|---|
| `Milestone` | The row's ID — `M1`, `M5a`, `G1`. Never validated, never renumbered |
| `Owner` | `agent` or `operator`. An absent column or an empty cell means `agent` |
| `Status` | `pending`, `in_progress`, `done` or `needs_operator` |

**Fenced and quoted text is not the document.** Both the table parser and the pause-block reader
scan through `src/pipeline/markdown-scan.ts`, so a heading, a table row or a checkbox inside a
``` fence or behind a `> ` is a picture of one, never the thing itself. That is what lets the
plan and execute prompts carry a worked example of this very table without an agent's quoting it
back handing the loop a second table to execute. Two consequences worth knowing:

- If the only "Execution Status" heading in the file is fenced, the error says so and names the
  line — it does not claim the heading is missing.
- An **unterminated** fence swallows everything after it, as CommonMark says it should. If a
  ticked resume marker does not resume, `drive` names the stray fence as the likely cause.

### One session per milestone

The table is the source of order. On every pass the handler takes the **first row whose status
is not `done`** and, if it is an agent row, runs one Claude Code session on exactly that milestone.
The session implements it, runs build, lint and tests, sets the row to `done`, and ends. The
pipeline then commits (`vibe-racer: M3 for #TASK`), re-reads the table, and goes round again.

The loop never counts `pending` cells and never trusts a counter. A table that cannot be parsed —
renamed column, emoji status, no table under the heading — sends the task to `error` with a
message naming the file and what was expected. It is never read as "nothing left to do".

### The four ways execution stops

Termination is structural: the loop stops even if the agent ignores every instruction in its
prompt. There are three bounds and one planned stop.

1. **Planned gate.** The first unfinished row has `Owner = operator`. The pipeline pauses
   **before** starting a session — a planned gate costs zero sessions.
2. **Agent-declared.** The session set the row to `needs_operator` and appended an "Operator
   actions" block explaining why. The pipeline pauses after that one session.
3. **Stall.** The session ended and the row is still not `done` — whether the agent refused in
   prose, changed nothing, or committed work without finishing. After `MAX_STALLED_SESSIONS`
   (currently 2) sessions on the same row the pipeline pauses and writes the agent's final message
   into the playbook, so nothing it explained is lost. Progress on a row resets the count.
4. **Session backstop.** A per-`drive` cap on total sessions, sized from the number of unfinished
   agent rows when the lap started. If it trips, the task **pauses** with a safety-limit note; it
   does not error.

**After a session-backstop pause, the row gets one session, not two.** Resuming spends a "resume
budget" that buys the row a single session before the next pause, because for the other three
stops the operator has looked at the pause and said *go on*. The backstop is the pipeline
interrupting itself, so a genuinely oversized milestone can pause once per `drive` until it
happens to finish in one session. That is bounded, never a loop — but the remedy is to split the
milestone, not to keep running `drive`.

A fifth case is not a stop but an end: an unfinished operator row with **no agent milestone after
it** (a merge or tag row from a playbook written before operator gates) is treated as the end of
the lap. The loop logs the rows, leaves them alone, and completes into `ai_qa`.

When the last agent milestone lands, the task advances to `ai_qa` rather than straight to
cleanup.

### The `need_operator` detour

Every pause looks the same from the outside:

- **The playbook** gains a numbered `## Operator actions — pause N (<row>)` block at the end:
  why it stopped, a `- [ ]` checklist of what to do, the read-only verification the agent will run
  when it comes back, the agent's final message quoted inertly (as `> ` lines, so a checkbox in it
  is never counted), the resume marker, and a closing line naming the task branch to switch back
  to. The row's status becomes `needs_operator`. If the agent wrote the block itself, the handler
  normalises it rather than appending a second one.
- **`state.yml`** goes to `need_operator`, written by the handler — the agent cannot write state
  (guard Rule 0). The pause is committed with a clean working tree, because your next move is
  usually git work.
- **The terminal, `pitwall` and `drive`** show the task under "waiting on operator" with the
  one-line reason and the file to edit, in neutral styling. It is never called an error.

There are three supported ways out:

1. **Do the work** — tick every item, tick "Operator actions complete — resume execution", run
   `vibe-racer drive`. The task returns to `ready_to_execute` and execution continues **in the
   same invocation**: an operator gate row is set to `done`, an agent row that declared
   `needs_operator` goes back to `pending` for a retry.
2. **Overrule the agent** — tick the items and the marker without doing anything. The agent
   retries once; if it hits the same wall, the task pauses again after **one** session with a new
   numbered block that says it is a re-pause and what the verification found. Bounded, never a loop.
3. **Skip or rewrite the milestone** — edit the Execution Status table by hand: mark the row
   `done`, reword, renumber or delete it, then tick and resume. Resume only rewrites the two
   statuses the pipeline itself wrote, so a row you set to `done` stays `done` and a renamed or
   deleted row does not break anything — execution continues from the first unfinished row as you
   left it.

Ticking the marker with items still open unticks it again, lists the outstanding items, and starts
no session. Only the **last** pause block is ever read: a fully ticked earlier block, or the
"Ready to advance to Execution" tick from sign-off, never resumes a current pause.

### Gate verification

The milestone after a gate begins by confirming the gate actually cleared, using the read-only
`**Verification:**` line the plan recorded for it (`git merge-base --is-ancestor`, `gh pr view`,
…). The agent runs it, not the pipeline: turning plan text into commands the pipeline executes on
your machine is a trust decision left for another task. When the check cannot run — for example
under the recommended `--network none` sandbox — the agent falls back to local refs, and if that is
inconclusive it takes your tick as the answer and says so in the session output. Only a check that
ran and showed the gate unmet is a reason to pause again.

### Known limitation: QA scope after a gate

The QA lap reviews `git diff main...HEAD`. Once work merged at a gate — other PRs, infrastructure,
credentials — is in `main` and the branch is updated, that work leaves the diff and QA reviews a
fraction of the task. This task does not fix that; it makes it visible. `qaPrompt` is told every
gate the playbook carries, and the QA report opens with its coverage: *"This task paused at G1
(PRs merged into main). Work merged before that gate is outside `git diff main...HEAD` and was not
reviewed here."* A follow-up task, "QA scope survives mid-task merges", owns the fix.

### The guard is unchanged

Operator gates changed no security rule. `canUseTool` in `src/claude/guard.ts` is exactly what it
was before this work: the same blocklist, the same path jail, the same Rule 0. The rule that an
execute session never pushes, opens or merges a PR, or deploys is a **prompt rule**; enforcing it in
the guard is the follow-up task "Guard enforces the no-push rule", which must keep the read-only
`git fetch`, `gh pr view` and `gh pr list` allowed or gate verification stops working.

### Upgrading a playbook that predates operator gates

Nothing here is retroactive and no migration code ships. Rolling the fix onto a task already in
flight is your work, and it is small:

- **A consumer repo keeps the old loop until `vibe-racer` is rebuilt and reinstalled there.**
  Rebuilding this repository only updates its own `npm link`; every other project runs whatever
  bundle it has installed until you reinstall.
- **A playbook with no `Owner` column still parses and still runs** — every row defaults to
  `agent`. But a human-owned step inside it is invisible to the table, so it takes the stall path:
  the agent refuses, the pipeline pauses after `MAX_STALLED_SESSIONS` sessions, and it pays those
  sessions again on every `drive` until the row is fixed. Bounded, never a loop, but not free. The
  pause block written there already says what to add ("This playbook predates operator gates; add
  a gate row to the Execution Status table if this step is yours").
- **The zero-session path** is one hand edit at the pause: add an `Owner` column and give the
  step its own `Owner = operator` row before the milestone it unblocks. Hand edits to the table at
  a pause are safe by design, and a row that no longer exists is simply skipped on resume.
- **Rows already `done` stay `done`.** No status is rewritten and nothing is renumbered.
- **Merge, tag, release and deploy are not in the playbook.** The lifecycle, once and in order:
  execution ends at the last agent milestone → `ai_qa` reviews `git diff main...HEAD` → cleanup →
  you merge and tag. A pre-gate playbook that lists those as rows still completes into QA (the
  loop treats a trailing operator row as the end of the lap), and the rows can be deleted at any
  time.

## QA and Decision

Two sessions close out a task:

- **QA (`ai_qa`)** — a QA Engineer session scoped to `git diff main...HEAD` writes `05_qa.md`: what works, what doesn't, what regressed, deviations, risks, and a verbatim verification run. It is write-jailed to the plan folder, so it judges without fixing. Because it runs before cleanup, it reviews the code and leaves project-documentation freshness to the cleanup lap — unless the plan made a doc an acceptance criterion. If the task paused at operator gates, the handler passes them in and the report opens with a coverage statement naming each gate (see [Known limitation: QA scope after a gate](#known-limitation-qa-scope-after-a-gate)). If the session does not produce `05_qa.md`, the handler throws rather than advancing — an unwritten report would otherwise strand the task at a pit stop with no file to tick.
- **Decision (`cleanup_ready`)** — the cleanup session runs first (docs, final build/lint/test, commit), then a Release Manager session writes `06_decision.md`, the post-deploy checklist. Same guard: no file, no advancement.

Both handlers append the completion checkbox only if the document does not already carry one,
so a session that writes its own "# Complete" section cannot leave two checkboxes behind.
