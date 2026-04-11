# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
