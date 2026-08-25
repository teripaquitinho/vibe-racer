# vibe-racer

CLI that runs structured AI pipelines ("races") on software tasks using Claude Code SDK. Each task moves through a fixed state machine — alternating between human pit stops and AI-driven laps — ending in committed, tested code.

## Key docs

- **Pipeline stages & architecture**: `docs/how-it-works.md`
- **All CLI commands**: `docs/commands.md`
- **Configuration (`.vibe-racer.yml`)**: `docs/configuration.md`
- **Roadmap**: `backlog.md`

## Project structure

```
src/
  cli/          # commander commands (init, new, drive, pitwall, radio, fasten)
  pipeline/     # state machine, validation
    handlers/   # one handler per agent stage (qa.ts, execute.ts, done.ts, review-runner.ts, ...)
  claude/       # SDK session runner, prompt builder, tool guard, skills, fasten analysis
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
- **Persona per lap** — system prompt is extended with a role-specific persona (Product Designer / Architect / Engineer / QA Engineer / Release Manager) depending on the current stage. Personas live in `PERSONAS` in `src/claude/prompts.ts`.
- **Seven laps, seven documents** — objective, product, design, plan, execute, QA (`05_qa.md`, written by `handlers/qa.ts`), decision (`06_decision.md`, written by `handlers/done.ts`). Execution advances to `ai_qa`, not to cleanup.
- **`state.yml` is pipeline-owned** — guard Rule 0 denies agent `Write`/`Edit` to any `state.yml` under `plans_dir` at every stage. Stage changes go through `updateStage` only. `setError` salvages a corrupt `state.yml` rather than dying on it.
- **One questions file per stage** — `STAGE_QUESTIONS_FILE` in `src/pipeline/states.ts` must stay injective. Two stages sharing a file means a stale tick advances the later one without human input (issue #3).
- **Completion checkboxes are appended idempotently** — handlers use `ensureCompletionSection`, never a bare append; a session that writes its own "# Complete" block would otherwise leave two checkboxes in one file.
- **Tool guard** — `canUseTool` in `src/claude/guard.ts` enforces security rules on every SDK tool call.
- **Skills per lap** — `src/claude/skills.ts` maps each agent stage to a lap and each lap to a skill list (`skills` key in `.vibe-racer.yml` overrides). Sessions load `settingSources: ["project", "user"]`.
- **Trivial fast-path** — detected by file presence, not by the agent writing state: objective review writes `03_plan_questions.md` instead of `01_product_questions.md`, and the handler sets `trivial: true` itself. Trivial tasks skip product and design laps.
