# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **`need_operator` stage** — a pit stop outside the linear sequence, entered by the execution lap when a milestone needs the operator and always returning to `ready_to_execute`. `state.yml` records `paused_stage`, `operator_milestone` and a one-line `operator_reason`; the handler writes it, never the agent (Rule 0 unchanged). `pitwall` and `drive` list paused tasks under "waiting on operator" with the reason and the file to edit, `--retry` leaves them alone, and `radio` opens at the stage with a role description written for a pause
- **Operator gates** — a step vibe-racer must not or cannot take is declared at plan time as its own `Owner = operator` row (`G<n>`) in the Execution Status table, with a matching `## G<n> — <name>` section in `03_plan.md` carrying a `- [ ]` checklist and a read-only `**Verification:**` line. The playbook carries an "Operator gates" section above the sign-off checkbox, and `drive` prints the gates (or "none") when advancing past `need_execution`. A planned gate pauses execution with **no session started**
- **The operator pause block** (`src/pipeline/operator-block.ts`) — every pause appends a numbered `## Operator actions — pause N (<row>)` block to `04_execute.md`: why it stopped, a checklist, the verification to run on resume, the agent's final message quoted inertly, the resume marker `Operator actions complete — resume execution`, and the task branch to switch back to. Only the last block is ever read; a checkbox behind `> ` is never counted. Resume settles the paused row (gate → `done`, agent row → `pending`), honours hand edits to the table, and continues execution in the same `drive` invocation
- **The Execution Status table contract** (`src/pipeline/execute-table.ts`) — a real parser for the one table that drives execution, with `Owner` as an optional column defaulting to `agent`, plus `EXECUTION_TABLE_SPEC` and `PAUSE_BLOCK_SPEC`, built from the source unions and interpolated into the plan and execute prompts so the prompts cannot drift from the handler again
- The QA prompt is told which operator gates the task paused at and opens its report with a diff-coverage statement, because work merged at a gate leaves `git diff main...HEAD`

### Changed

- **`handleExecute` rewritten** around a pure `decideNextStep` / `foldOutcome` core with a thin driver. One session per milestone against the Execution Status table; the log line names the row (`Executing M9 (attempt 2/2, 9 remaining)`) instead of a session counter. Execution stops for four reasons — planned gate, agent-declared `needs_operator`, a stall after `MAX_STALLED_SESSIONS` (2) sessions on one row, or the per-`drive` session cap — and every one of them pauses rather than errors. `countPendingMilestones` and the "agent already committed" line are gone
- `STAGE_QUESTIONS_FILE` maps each human stage to a `(file, markerText)` pair, and it is the pair that must stay unique. `need_execution` and `need_operator` share `04_execute.md` on different markers; a test enforces the invariant
- `blocked` is removed from the milestone status union. A legacy playbook that still carries it is parsed as `needs_operator` and pauses, with a block saying an earlier run marked it
- The plan prompt no longer plans post-execution steps as rows: merge, tag, release and deploy of the task's own work come after QA. The `need_execution` sign-off refuses the tick when the table ends in an operator row with nothing after it, names the rows and unticks the box; the execute prompt tells the agent to leave such a row alone; and the loop completes into `ai_qa` on one instead of pausing
- The execute prompt carries the `needs_operator` protocol, the explicit no-push / no-PR / no-merge / no-deploy rule, and gate verification with a fallback ladder (read-only check → local refs → the operator's tick, said aloud)
- `executeMilestonePrompt` takes the milestone row to execute; `qaPrompt` takes the list of gates
- `EXECUTION_TABLE_SPEC`'s worked example ships without its `## Execution Status` heading. The parser reads the first such heading in the file, so an agent that quoted the contract into its playbook handed the loop a table to execute instead of the real one — and the status writer then edited the quoted copy
- Correction to the 0.1.0 entry below, left as written: the Bash blocklist has **18** entries, not 19. `BASH_BLOCKLIST` and the list in `docs/security.md` have always agreed with each other; only the count was wrong

### Fixed

- **The execution lap looped forever on a milestone the agent could not complete.** The only exit was a regex count of `pending` cells reaching zero, so a session that refused in prose and changed nothing was followed by another identical session, each one a paid SDK call, until someone hit Ctrl-C. The loop is now bounded three ways and hands the task to the operator instead
- An unparseable status table no longer advances to `ai_qa` with nothing executed; the task goes to `error` naming the file and what was expected
- A `blocked` row no longer skips work — it pauses
- A playbook whose only unfinished rows are the operator's own merge and tag now completes into QA instead of spinning on them
- A `pending` cell in the milestone summary table or in prose no longer keeps the loop alive; only the table under "Execution Status" is read
- The pause block no longer blames an oversized milestone for an undeclared human step. The post-session repository snapshot was taken after the pipeline's own `commitAll`, which runs `git add .`, so any edit the agent made — including the Notes cell the playbook asks it to write — read as "the agent committed work but did not finish"
- A gate settled on resume no longer leaves `resumed_at` in `state.yml`. The gate never runs, so the unspent one-session budget sat there until some later row was renumbered into it
- A ticked resume marker that `drive` cannot act on now says why. An unterminated code fence anywhere above the pause block hides it from the fence-aware reader, and resume failed in complete silence; a paused task whose playbook has gone missing is named too

## [0.3.0] - 2026-09-13

### Added

- **QA lap (`ai_qa` -> `fine_tuning`)** — after the last execution milestone, a Senior QA Engineer session scoped to `git diff main...HEAD` writes `05_qa.md`: what works, what doesn't, what regressed, deviations, risks, and a verbatim verification run. Write-jailed to the plan folder, so it judges without fixing
- **Decision lap (`cleanup_ready` -> `need_decision`)** — the cleanup session is followed by a Release Manager session that writes `06_decision.md`, a post-deploy checklist traced to the objective, the acceptance criteria, and the QA risks. `drive` refuses to reach `done` while any `- [ ]` remains in it
- **Per-lap skills** — every agent stage maps to a lap, and each lap resolves to a list of Claude Code skills (`skills` key in `.vibe-racer.yml`; defaults: `simplify` on execute, `security-review` on QA). Missing names warn and are skipped; a failed probe degrades to persona-only
- **`jailToPlanDir`** — a per-session guard flag that applies the Rule 4a write jail regardless of stage. The cleanup and decision sessions share the `cleanup_ready` stage but have opposite needs (cleanup edits docs repo-wide; the decision session writes one file), and stage alone cannot separate them. The decision session is now jailed to the plan folder
- **Guard Rule 0** — `Write`/`Edit` to any `state.yml` under `plans_dir` is denied at every stage. `state.yml` is pipeline-owned; only `updateStage` moves a task
- New personas: QA Engineer and Release Manager

### Changed

- The pipeline is now **seven laps**: objective, product, design, plan, execute, QA, decision. `STAGES` gains `ai_qa` and `need_decision`
- `drive --retry` resumes from the stage recorded in `error_stage` instead of re-dispatching the `error` stage. An unrecognized `error_stage` prints instructions rather than throwing
- Trivial fast-path is detected by file presence (objective review writes `03_plan_questions.md` instead of `01_product_questions.md`) rather than by the agent writing `trivial: true` into `state.yml`
- `setError` survives an unparseable `state.yml`: it salvages `title`/`created`/`trivial` from the raw YAML, and falls back to hand-writing a minimal valid error record. Previously the recovery path died on the same corrupt file it was recording
- Sessions load `settingSources: ["project", "user"]` so project- and user-scope skills resolve. This widens the trust boundary — documented in `docs/security.md`
- `writeState` is exported from `state/store` again. 0.2.0 un-exported it as an internal symbol; the trivial fast-path re-plumb needs it, so this is a deliberate reversal
- `SecretDetectedError` is exported from `git/operations` and rethrown rather than swallowed. A secret detected while committing partial work now aborts before `setError` records the stage, instead of being buried in the error path

### Fixed

- **Tasks at `fine_tuning` advanced to `cleanup_ready` without human input** ([#3](https://github.com/teripaquitinho/vibe-racer/issues/3)). `fine_tuning` and `need_execution` both pointed at `04_execute.md`, so the tick that left `need_execution` was still in the file when the task reached `fine_tuning` and advanced it a second time. `fine_tuning` now reads `05_qa.md`, which the QA lap writes with a fresh unchecked box
- Completion sections are appended only when the document has none. A session that wrote its own "# Complete" block previously left two checkboxes in one file — at `need_decision` the second, unticked one was counted as an unworked checklist item, so the task could not advance
- `removeCompletionMarker` unchecks every marker in a file, not just the first
- **Every lap failed with `claude_code_version_too_old` when the user's Claude Code settings select a Claude 5 model**. `@anthropic-ai/claude-agent-sdk` was pinned to `^0.2.x`, which bundles Claude Code 2.1.101; Fable 5.1 and the other Claude 5 models require 2.1.251 or newer. Bumped to `^0.3.270` (bundles Claude Code 2.1.270)
- Reaching `done` left the task uncommitted. Every other stage has its `state.yml` write swept up by the next lap's handler commit, but `done` is terminal — so the operator's worked checklist and the final stage write sat dirty in the working tree with no lap left to commit them. `drive` now commits on the task branch and reports the task complete

## [0.2.0] - 2026-04-16

### Added

- `vibe-racer fasten` CLI command — runs a Claude-driven dead code analysis and writes findings into a new plan's `00_objective.md`, ready for the standard pipeline to execute the cleanup
- Trivial fast-path support: `fasten`-generated plans skip product and design laps, going directly from objective review to plan questions

### Changed

- Un-exported 13 internal symbols across `git/operations`, `git/secrets`, `state/store`, `state/plan-folder`, `state/advancement`, `pipeline/validation`, `pipeline/machine`, and `claude/fasten`; tests now exercise these through public APIs

### Removed

- Deprecated label-based pipeline API (`LABELS`, `LABEL_ORDER`, `nextLabel`, `previousLabel`, `isAgentActionable`, etc.) — fully superseded by the stage-based API
- Dead config helpers in `src/config/loader.ts` (`detectProjectInfo`, `parseRepoUrl`)
- Unused `src/utils/links.ts` module (planned share-link feature, never wired up)

## [0.1.0] - 2026-04-11

First public release.

### Added

- 5-lap development pipeline: objective, product, design, plan, execute
- CLI commands: `init`, `new`, `pitwall`, `drive`, `radio`
- Claude Code SDK integration with role-based personas (Product Designer, Software Architect, Software Engineer, Race Engineer)
- Two-layer security guard: `allowedTools` per lap + `canUseTool` callback
- Path containment (project cwd + /tmp, symlink-aware)
- Bash command blocklist (19 entries) with interpreter-aware network detection
- Obfuscation heuristics for base64 encoding and character code construction
- Pre-commit secret scanning (filename + content pattern matching)
- Append-only audit log for guard denials
- Trivial task flagging (skip product + design laps)
- Follow-up question rounds (max 3 rounds, 5–6 questions per round)
- Pre-filled answers: agent recommends, human edits disagreements only
- Git-native workflow: local branches, automatic commits, no push
- Example task included (`plans/0001_example-todo-app/`)
- VitePress documentation site at <https://teripaquitinho.github.io/vibe-racer/>
