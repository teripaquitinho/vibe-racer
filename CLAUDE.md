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
    markdown-scan.ts   # fence/blockquote-aware line scan shared by the two readers below (leaf module, no imports)
    execute-table.ts   # the Execution Status table contract: parser, status writes, table queries, EXECUTION_TABLE_SPEC
    operator-block.ts  # the "Operator actions" pause block: render, find, normalise, read, PAUSE_BLOCK_SPEC
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
- **Seven laps, seven documents** — objective, product, design, plan, execute, QA (`05_qa.md`, written by `handlers/qa.ts`), decision (`06_decision.md`, written by `handlers/done.ts`). Execution is one session per milestone against the Execution Status table in `04_execute.md` (`handlers/execute.ts`, parsed by `execute-table.ts`), bounded by `MAX_STALLED_SESSIONS` per milestone and a per-`drive` session cap sized from the unfinished agent rows; the loop never trusts a regex count. Execution advances to `ai_qa`, not to cleanup.
- **`state.yml` is pipeline-owned** — guard Rule 0 denies agent `Write`/`Edit` to any `state.yml` under `plans_dir` at every stage. Stage changes go through `updateStage` only. `setError` salvages a corrupt `state.yml` rather than dying on it.
- **One markdown reader** — `execute-table.ts` and `operator-block.ts` both scan through `markdown-scan.ts` (`scanLines`/`isHeading`/`isLive`), so a heading, table row or checkbox inside a fence or behind a `> ` is inert to *both*. They used to disagree: the table parser matched headings with a bare regex, so the worked example an agent quoted into its own playbook outranked the real table — the loop executed the quotation and the status writer edited it. Hence `EXECUTION_TABLE_SPEC` ships without its own `## Execution Status` heading and `PAUSE_BLOCK_SPEC`'s example stays fenced when interpolated. `markdown-scan.ts` imports nothing by design, so `execute-table.ts` can be pulled into prompts without a cycle. An unterminated fence swallows the rest of the file, as CommonMark says it does; callers that can be defeated that way name the stray fence instead of failing silently.
- **One `(file, markerText)` pair per stage** — `STAGE_QUESTIONS_FILE` in `src/pipeline/states.ts` maps each human stage to a *pair*, and it is the **pair** that must stay unique, not the file. `need_execution` and `need_operator` both read `04_execute.md` but never share a marker: the resume marker is `Operator actions complete — resume execution`, deliberately not a "Ready to advance …" line. Pointing `need_operator` at a "Ready to advance" marker is the issue-#3 stale-tick regression in its new form — the ticked sign-off box already in the file would resume a pause nobody looked at — and `states.test.ts` fails if anyone does.
- **Operator gates and the `need_operator` detour** — a step vibe-racer must not or cannot take is declared at plan time as its own `Owner = operator` row (`G<n>`) in the Execution Status table, never as prose between rows. `need_operator` lives outside `STAGE_ORDER` (with `error`, in `NON_LINEAR_STAGES`) and always returns to `ready_to_execute`. The agent signals through `04_execute.md` only — a `needs_operator` status and an "Operator actions" pause block — and the handler writes the stage (`pauseForOperator`), the agent never does. Resume reads the **last** pause block only and settles just the two statuses the pipeline itself wrote, so hand edits to the table survive.
- **Where the execute lap ends** — the Execution Status table holds only work that finishes before QA. Merge, tag, release and deploy of the task's own work are never rows: QA reviews `git diff main...HEAD` and needs the branch unmerged. Every gate row is followed by the milestone it unblocks; the plan prompt says so, `tryAdvance` refuses the `need_execution` sign-off tick when it is not true (`trailingOperatorRows`), and the loop completes into `ai_qa` rather than pausing on a trailing gate left by an older plan.
- **Completion checkboxes are appended idempotently** — handlers use `ensureCompletionSection`, never a bare append; a session that writes its own "# Complete" block would otherwise leave two checkboxes in one file.
- **Tool guard** — `canUseTool` in `src/claude/guard.ts` enforces security rules on every SDK tool call.
- **Skills per lap** — `src/claude/skills.ts` maps each agent stage to a lap and each lap to a skill list (`skills` key in `.vibe-racer.yml` overrides). Sessions load `settingSources: ["project", "user"]`.
- **Trivial fast-path** — detected by file presence, not by the agent writing state: objective review writes `03_plan_questions.md` instead of `01_product_questions.md`, and the handler sets `trivial: true` itself. Trivial tasks skip product and design laps.
