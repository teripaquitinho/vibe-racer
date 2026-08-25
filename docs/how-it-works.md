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

Advancement is keyed on one file per stage: `00_objective.md`, `01_product_questions.md`,
`02_design_questions.md`, `03_plan_questions.md`, `04_execute.md`, `05_qa.md`,
`06_decision.md`. No two stages share a file — a stale tick left in an earlier lap's
document cannot advance a later one.

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

During the execution lap (`ready_to_execute`), the race engineer processes milestones continuously:

1. Read the next unchecked milestone from `04_execute.md`
2. Implement the code changes
3. Run build, lint, and tests
4. Commit with message `vibe-racer: milestone N for #TASK`
5. Check the milestone checkbox in `04_execute.md`
6. Repeat until all milestones are done

No human intervention between milestones. The full execution runs in a single session.

When the last milestone lands, the task advances to `ai_qa` rather than straight to cleanup.

## QA and Decision

Two sessions close out a task:

- **QA (`ai_qa`)** — a QA Engineer session scoped to `git diff main...HEAD` writes `05_qa.md`: what works, what doesn't, what regressed, deviations, risks, and a verbatim verification run. It is write-jailed to the plan folder, so it judges without fixing. Because it runs before cleanup, it reviews the code and leaves project-documentation freshness to the cleanup lap — unless the plan made a doc an acceptance criterion. If the session does not produce `05_qa.md`, the handler throws rather than advancing — an unwritten report would otherwise strand the task at a pit stop with no file to tick.
- **Decision (`cleanup_ready`)** — the cleanup session runs first (docs, final build/lint/test, commit), then a Release Manager session writes `06_decision.md`, the post-deploy checklist. Same guard: no file, no advancement.

Both handlers append the completion checkbox only if the document does not already carry one,
so a session that writes its own "# Complete" section cannot leave two checkboxes behind.
