# Execution Playbook — #7: guard-actually-runs

> **Source of truth for progress.** The Execution Status table below is the order and the state.
> `03_plan.md` is the source of truth for *what each milestone contains*. Do not add scope.

---

## Execution order

Ten agent milestones and four operator gates, strictly sequential. The ordering rule is one
sentence: **everything that can be got wrong for free lands before the milestone that makes
enforcement live, and everything whose content depends on a paid run lands after it.**

```
G1  driver worktree          operator — free, no session
M1  guard.ts   -> decideToolCall                 refactor, nothing calls it
M2  tools.ts   -> one list, seven literals gone  refactor, nothing enforces it
M3  audit.ts   -> union + rotation + self-ignore refactor + the RED wiring test
M4  guard-hook.ts + session-options.ts    *** THE FIX — enforcement is live here ***
M5  guard-preflight.ts + the exact SDK pin       live + refuses
M6  suppression, summary, radio + init notices   live + legible
M7  heartbeat DETECT only (HEARTBEAT_ABORTS=false)
G2  npm run test:live        operator — L1..L8, and L5 blocks M8
M8  fork resolution: abort + bypass contract, or warning-only
G3  seven-lap dry run        operator — this branch's build, scratch repo
M9  classify every denial; prompt fixes and any narrowing
G4  re-run only what M9 changed   operator
M10 docs, disclosure, CHANGELOG, .gitignore
```

**`M1` to `M4` is compiler-enforced.** `GuardRuleId`, `GuardDecision` and `GuardOptions.tools` do
not exist before `M1`, and `createToolGuard` does not exist after it, so landing `M4` first is not
a thing that can happen. `M4` to `M5` is **not** compiler-enforced: pre-flight check 2 asserts on a
real built options object, and written earlier its own test would have to be skipped. Keep the order.

**`M4` is the milestone that fixes the bug.** Everything before it is a refactor with no runtime
behaviour change; everything after it depends on enforcement already being live.

---

## Step-by-step protocol

For each row in the Execution Status table, in order:

1. Take the **first unfinished row**. Do not skip, do not reorder.
2. If its `Owner` is `operator`, **stop**. The pipeline pauses and writes the checklist from that
   gate's `## G<n>` section in `03_plan.md` into this file. Do not do the operator's work and do not
   tick their checklist.
3. Set the row's status to `in_progress`.
4. Read the milestone's section in `03_plan.md` — it carries the file paths, function signatures and
   data structures. Implement **all** of its numbered tasks, and nothing outside them.
5. Write the tests listed under that milestone's **Test requirements**. Tests land in the same commit
   as the code they cover, with one exception: `M3` adds the red wiring test for code that does not
   exist yet, and `M4` flips it to green. That is deliberate — see `03_plan.md` §14.
6. Verify, all four, in this order:
   ```bash
   npm run build && npm run typecheck && npm run lint && npm run test
   ```
7. Fix anything that is not green. A milestone is not done until all four are.
8. Set the row's status to `done` and fill in the Notes cell with anything the next milestone, a
   gate or the QA lap needs to know.
9. The pipeline commits the milestone.

**At a gate row that has just been settled**, run the gate's `**Verification:**` line from
`03_plan.md` first — it is read-only — and say what it returned before starting the next milestone.
If it fails, do not proceed: say so and pause.

---

## Rules

- **One milestone at a time.** Take the first unfinished row. No skipping, no reordering, no starting
  a later milestone because the current one is awkward.
- **Always commit.** Every milestone is its own commit, with a passing build and a green suite.
- **Follow the plan.** `03_plan.md` is the specification. If something in it does not work, adapt the
  implementation but keep the same goals — and record the deviation in the Notes cell.
- **This task is driven by the worktree binary, not by its own build.** Every milestone ends with
  `npm run build`, which overwrites the `dist/` bundle the globally linked `vibe-racer` runs. `G1`
  exists so that every `drive` for this task is `node ../vibe-racer-main/dist/index.js drive`. Do not
  "helpfully" drive this task with `npm run dev` or the global binary.
- **Coverage only goes up.** Baseline is **34 test files / 675 tests, all green**. A milestone that
  keeps the suite green by deleting or skipping a test is not done. Three recorded exceptions, each
  replacing what it removes with a strictly larger set: `M1` deletes the two `canUseTool` cases in
  `tests/claude/session.test.ts` (restored through the hook in `M4`); `M1` retargets
  `tests/claude/guard.test.ts` from message strings onto rule ids, with the messages asserted once in
  a byte-identity table; `M3` deletes the "skips write when file exceeds 1 MB" audit case, which
  asserts the behaviour F6.3 removes.
- **Rule conditions and messages do not change.** This task moves *where* the rules are enforced, not
  *what* they are. The only exception is a narrowing `M9` makes inside F10's bright line, recorded
  with the denial that motivated it. Guardrails only tighten.
- **No new runtime dependencies.** Nothing is added to `package.json`'s `dependencies`. `M5` changes
  one version string there, from `^0.3.270` to `0.3.270`, and regenerates the lockfile.
- **No `--unguarded` flag, no env escape, no warn-only mode.** If a milestone seems to need one,
  it has misread the plan.
- **No version bump, no release, no push, no PR, no merge.** `vibe-racer never pushes`. Merge,
  version, publish and `npm deprecate` are the operator's, after the task reaches `done` — see
  "After the last milestone" below.
- **`state.yml` is pipeline-owned.** Never write or edit it. The pipeline moves the task.
- **`markdown-scan.ts`, `execute-table.ts` and `operator-block.ts` are not touched by any
  milestone.** No stage is added and no transition changes. A finding there becomes a follow-up.

---

## Execution Status

Rows are taken in order, top to bottom. `Owner` = `operator` means the pipeline pauses and waits;
every such row is followed by the milestone it unblocks.

| Milestone | Name | Owner | Status | Commit | Notes |
|---|---|---|---|---|---|
| G1 | Build the driver worktree of `main` | `operator` | `pending` | — | Unblocks M1. `git worktree add ../vibe-racer-main main`, then `npm ci && npm run build` in it. Every `drive` for this task from here to `done` is `node ../vibe-racer-main/dist/index.js drive` |
| M1 | `guard.ts` becomes a decision core | `agent` | `pending` | — | Byte-identity message table written **first**, from the current source. Rule 1 (review-stage Bash) stays before rule 2 (membership). `createToolGuard`, its `deny()` and the unconditional `Skill` allow are deleted in the same commit as the test retarget |
| M2 | `tools.ts`, one list from one place | `agent` | `pending` | — | Seeds `TaskOutput`/`TaskStop` only where `Bash` is listed; `TodoWrite`/`BashOutput`/`KillShell` do **not** exist in this SDK (Q2 overrides design §19.1). Also lands the live-tier scaffolding and probe `L8` |
| M3 | `audit.ts` becomes evidence | `agent` | `pending` | — | Ends by adding the **red** wiring test (`it.fails`, both regression assertions in one test). The suite stays green at M3 |
| M4 | **The fix: the hook runs** | `agent` | `pending` | — | `hooks.PreToolUse` with no matcher; `canUseTool` gone; `tools` narrowing replaces `allowedTools`; banner printed only downstream of `assertHookInstalled`. Flips M3's `it.fails` to `it` — the red-to-green transition is this milestone's acceptance evidence |
| M5 | Pre-flight refusal and the SDK pin | `agent` | `pending` | — | Four checks reported 1-2-3-4; refusal renderer in one place; call sites are `drive` (after task selection, before `checkoutBranch`) and `fasten`. Pin `0.3.270` exactly and regenerate `package-lock.json` in the same commit |
| M6 | Denial surfaces and honest banners | `agent` | `pending` | — | Suppression keyed on `(tool, rule, reason)` with a `U+0000` separator; `summary()` null at zero and printed in a `finally`; `radio` notice; `init` banner no longer says `canUseTool` |
| M7 | Heartbeat, detect-only | `agent` | `pending` | — | `HEARTBEAT_ABORTS = false` — warn and audit, do not abort. Writes probe `L5`, which `G2` runs. Record in Notes that the abort is unshipped pending `G2` |
| G2 | Run the live probe suite (`npm run test:live`) | `operator` | `pending` | — | Unblocks M8. Real paid sessions — the spend is the operator's. Results go in `04_live_probes.md`, one row per probe `L1`–`L8`. **`L5`'s verdict selects M8's branch**; `L7` is the manual `fasten` check |
| M8 | Fork resolution: the bypass contract | `agent` | `pending` | — | Read `04_live_probes.md` **first** and record the verdict verbatim here. Branch A (clean) or B (lever) ship the abort, `GuardBypassError`, the wrapper branch, `commitPaths`, the two `state.yml` fields and the retry gate. Branch C (unexcludable, or `L5` not run) ships warning-only and documents why |
| G3 | The seven-lap dry run | `operator` | `pending` | — | Unblocks M9. **This branch's build**, in a scratch repository, with a throwaway task. Leaves `04_dry_run.md` (one line per lap) and `dry-run-audit.log`. Redact credentials before copying — the secret scanner runs on M9's commit |
| M9 | Classify and fix | `agent` | `pending` | — | Every denial into one of F10's three outcomes; prompt fixes preferred; narrowing only where a lap cannot do its documented job, recorded with the denial. Write `## Changed by M9` precisely — it is the list `G4` re-runs |
| G4 | Re-run only the laps M9 changed | `operator` | `pending` | — | Unblocks M10. If `## Changed by M9` says nothing changed, tick without a run and say so. One round is planned; a second failure is a pause and a conversation |
| M10 | Docs, disclosure and housekeeping | `agent` | `pending` | — | Six documents, the CHANGELOG, this repo's `.gitignore`, and the final per-lap table in `04_dry_run.md`. **No path under `src/` changes.** The exact dated line: "0.3.0 did not enforce the tool guard; earlier versions are unverified." |

---

## Milestone summary

Reference only — the table above is what drives execution.

| # | Deliverable | Files touched | New tests |
|---|---|---|---|
| M1 | `decideToolCall`, `GuardDecision`, `GuardRuleId`; `createToolGuard` deleted | `src/claude/guard.ts`, `src/claude/session.ts` | `tests/claude/guard-messages.test.ts` (new), `guard.test.ts` (retargeted) |
| M2 | `TOOLS_BY_STAGE`, `DECISION_TOOLS`, `FASTEN_TOOLS`, `toolsForSession`; live tier exists | `src/claude/tools.ts` (new), `session.ts`, `fasten.ts`, five handlers, `package.json`, `vitest.live.config.ts` (new) | `tests/claude/tools.test.ts` (new), `tests/live/tool-names.live.test.ts` (`L8`) |
| M3 | Audit union, rotation, `ensureAuditDir`, `auditLogPath`, boolean return | `src/claude/audit.ts` | `audit.test.ts` (rewritten), `session.test.ts` (red wiring test) |
| M4 | The `PreToolUse` hook, one options builder, `canUseTool` dropped, `tools` narrowing | `src/claude/guard-hook.ts` (new), `session-options.ts` (new), `session.ts` | `guard-hook.test.ts` (new), `session.test.ts` (rewritten), `tests/live/` (`L1`–`L4`, `L6`) |
| M5 | Four-check pre-flight, the refusal renderer, the exact SDK pin | `src/claude/guard-preflight.ts` (new), `src/cli/drive.ts`, `src/cli/fasten.ts`, `src/git/operations.ts`, `src/pipeline/states.ts`, `package.json`, `package-lock.json` | `preflight.test.ts` (new), `drive.test.ts` + `fasten.test.ts` (extended) |
| M6 | Suppression, `summary()`, `radio`'s notice, `init`'s banner | `src/claude/guard-hook.ts`, `session.ts`, `src/cli/radio.ts`, `src/cli/init.ts` | `guard-hook.test.ts` (extended), `tests/cli/init.test.ts` (new), `radio.test.ts` (extended) |
| M7 | Bypass detection, `recordBypass`, `HEARTBEAT_ABORTS = false`, `src/version.ts` | `src/claude/session.ts`, `guard-hook.ts`, `src/version.ts` (new), `src/cli/index.ts` | `heartbeat.test.ts` (new), `tests/live/false-abort.live.test.ts` (`L5`) |
| M8 | The abort and the bypass contract — or warning-only, recorded | `src/claude/session.ts`, `guard-hook.ts`, `src/state/schema.ts`, `store.ts`, `src/git/operations.ts`, `src/pipeline/handlers/safe-wrapper.ts`, `src/cli/drive.ts` | `drive-retry.test.ts` (new), `heartbeat.test.ts` + `safe-wrapper.test.ts` + `store.test.ts` (extended) |
| M9 | Classification, prompt fixes, any narrowing | `04_dry_run.md`, `src/claude/prompts.ts`, maybe `tools.ts` / `guard.ts` | whatever pins each change; none if nothing changed |
| M10 | Docs, disclosure, CHANGELOG, `.gitignore` | `SECURITY.md`, `docs/security.md`, `docs/how-it-works.md`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `.gitignore`, `04_dry_run.md` | one documentation assertion for the dated line |

---

## Stack and technology reference

| Thing | What it is here |
|---|---|
| Runtime | Node >= 20, ESM (`"type": "module"`), TypeScript 5.9 strict |
| Build | `tsup` to `dist/`, one ESM entry (`src/index.ts`), target node20. No new entry point, no new bin |
| Tests | `vitest` 4. Default config is tiers 1–2 (`npm run test`); `vitest.live.config.ts` is tier 3 (`npm run test:live`), gated on `VIBE_RACER_LIVE=1` |
| Lint | `eslint` over `src/` only |
| SDK | `@anthropic-ai/claude-agent-sdk`, **pinned exactly to `0.3.270`** by `M5`. The hook contract (`HookCallback`, `PreToolUseHookInput`, `HookCallbackMatcher`), the `tools` option, `abortController` and the stream message shapes all come from its `sdk.d.ts` |
| Enforcement transport | `options.hooks.PreToolUse = [{ hooks: [run.hook] }]` — **no matcher key**, so every tool call is seen. `permissionMode` stays `"bypassPermissions"`: the sessions are unattended by design |
| Guard decision | `decideToolCall` in `src/claude/guard.ts` — synchronous, no I/O, imports `node:fs`/`node:path`/`node:os` and the `Stage` type only |
| Audit log | `.vibe-racer/audit.log`, one JSON object per line, `kind` first, rotated to `.1` at 1 MB, in a directory that writes its own `.gitignore` containing `*` |
| Git | `simple-git`. `commitAll` (existing, with the `scanFiles` secret scan), `isPathTracked` (M5), `commitPaths` + `isTreeClean` (M8) |
| State | `plans/0007_guard-actually-runs/state.yml`, pipeline-owned. `M8` adds `guard_bypass` and `guard_bypass_version` to the zod schema |
| Driver for this task | `node ../vibe-racer-main/dist/index.js drive` — a worktree of `main`, built at `G1` |

---

## After the last milestone

`M10` is the end of the execute lap. The task then goes to QA, which reviews `git diff main...HEAD`
and needs the branch **unmerged**. Merging this branch, the version number, publishing and
`npm deprecate vibe-racer@0.3.0` are the operator's, after `done` — none of them is a row in the
table above. The `done` lap's `06_decision.md` carries them, together with the expected README merge
conflict (which resolves in favour of the branch) and `git worktree remove ../vibe-racer-main`.

---

## Operator gates in this plan

Execution will pause at each of these and wait for you.

- **G1** — build a worktree of `main` (`git worktree add ../vibe-racer-main main`, then `npm ci && npm run build`) and drive this task from it for the rest of the task — before M1
- **G2** — run `npm run test:live` and record probes `L1`–`L8` in `04_live_probes.md`, including the manual `fasten` check (`L7`); `L5`'s verdict selects M8's branch — before M8
- **G3** — race a throwaway task through all seven laps in a scratch repository with **this branch's** build, and leave `04_dry_run.md` plus `dry-run-audit.log` — before M9
- **G4** — re-run only the laps M9 changed, and append a `## G4 — re-run` section to `04_dry_run.md`; if nothing changed, say so and tick — before M10

# Complete

- [ ] Ready to advance to Execution
