# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
