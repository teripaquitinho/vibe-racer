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
need_execution -> ready_to_execute -> fine_tuning -> cleanup_ready -> done
```

- **`need_*` stages**: Pit stops. Write content, review answers, tick checkbox.
- **`ai_*` stages**: Race engineer phases. Claude Code session runs automatically.
- **`error`**: Entered on race engineer failure. Use `--retry` to reprocess.

The `prev` and `next` fields in `state.yml` are auto-computed on write for navigation.

## Claude Code Sessions

Each race engineer phase runs a Claude Code SDK session with:

- **Preset**: `claude_code` -- gives the race engineer file editing, git, and codebase understanding capabilities
- **Persona**: Appended to the system prompt via the `append` field. Different persona per lap:
  - **Senior Product Designer** for objective and product review
  - **Software Architect** for design review
  - **Software Engineer** for plan review and execution
- **Context files**: Loaded from the `context` array in `.vibe-racer.yml` (default: README.md, CLAUDE.md)
- **Streaming**: Output is streamed to the terminal in real-time
- **Guard**: `canUseTool` callback enforces security rules on every tool invocation

## Advancement Logic

When you run `vibe-racer drive`, the following happens:

1. **Scan for ticked checkboxes**: All pit-stop tasks are checked for `- [x] Ready to advance to ...`
2. **Validate answers**: If the file has `**Answer:**` sections, all must be filled in (not blank)
3. **Advance**: If checkbox is ticked and answers are complete, the task advances to the next lap
4. **Find actionable tasks**: Tasks at race engineer phases are eligible for processing
5. **Dispatch**: The correct handler runs based on the current stage

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
