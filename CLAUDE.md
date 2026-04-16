# vibe-racer

CLI that runs structured AI pipelines ("races") on software tasks using Claude Code SDK. Each task moves through a fixed state machine — alternating between human pit stops and AI-driven laps — ending in committed, tested code.

## Key docs

- **What it is / pitch**: `pitch.md`
- **Pipeline stages & architecture**: `docs/how-it-works.md`
- **All CLI commands**: `docs/commands.md`
- **Configuration (`.vibe-racer.yml`)**: `docs/configuration.md`
- **Roadmap**: `backlog.md`

## Project structure

```
src/
  cli/          # commander commands (init, new, drive, pitwall, radio, fasten)
  pipeline/     # state machine, handlers per stage, validation
  claude/       # SDK session runner, prompt builder, tool guard, fasten analysis
  state/        # task discovery, state.yml read/write, advancement logic
  git/          # branch management, commits, secret scanning
  config/       # .vibe-racer.yml parsing
```

## Dev commands

```bash
npm run dev          # run CLI via tsx (no build needed)
npm run build        # tsup → dist/
npm run test         # vitest run
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/
```

## Key decisions

- **No runtime dependency on host project** — vibe-racer is a standalone CLI; it only reads the host project's README.md / CLAUDE.md as context.
- **State lives in `plans/NNNN_slug/state.yml`** — never in memory; every command re-reads state from disk.
- **One branch per task** (`vibe-racer/NNNN_slug`) — created automatically on first `drive`, never pushed automatically.
- **Persona per lap** — system prompt is extended with a role-specific persona (Product Designer / Architect / Engineer) depending on the current stage.
- **Tool guard** — `canUseTool` in `src/claude/guard.ts` enforces security rules on every SDK tool call.
- **Trivial fast-path** — tasks with `trivial: true` in `state.yml` skip product and design laps, going directly from objective review to plan questions.
