# Plan Questions for #7: guard-actually-runs

> **Role**: Senior Software Engineer
> **Stage**: `ai_design_review` → `need_plan`
> **Date**: 2026-10-12

---

The architecture is settled: `02_design.md` §4–§12 fixes the modules, the types, the rule order and
the bypass contract. What is left is **execution** — the order the pieces land in, where the three
operator gates sit, which binary drives this task while it rewrites `drive`, and when the tests that
would have caught the original defect are written relative to the code they guard.

Six questions. Each one changes the shape of the Execution Status table.

---

## Milestone sequence and gates

### Q1: What is the milestone order, and where do the operator gate rows sit?

The task has three things an agent cannot do — a paid live-probe suite, a seven-lap dry run, and a
re-run of whatever the dry run changed — and one milestone (`M4`) where enforcement stops being
dead code and starts denying things. Every other ordering decision follows from where those four
sit. What is the table?

**Answer:**
Ten agent milestones and four `Owner = operator` gate rows, in this order. Every gate is followed
by the milestone it unblocks (`tryAdvance`'s `trailingOperatorRows` check refuses a table that ends
on a gate), and no row merges, pushes, versions or publishes anything.

| Row | Owner | What lands | Enforcement state after it |
|---|---|---|---|
| `G1` | **operator** | **First row of the table.** Build a worktree of `main` and drive every remaining lap of this task from it (Q4): `git worktree add ../vibe-racer-main main`, then `npm ci && npm run build` inside it. From here to `done`, every `drive` for this task is `node ../vibe-racer-main/dist/index.js drive`, run from the task checkout. A planned gate costs no session (`decideNextStep`), so this pause is free | unchanged — and the pipeline driving this task now stays unchanged too |
| `M1` | agent | `guard.ts` → `decideToolCall`, `GuardDecision`, `GuardRuleId`; `createToolGuard` and its `deny()` deleted; tier-1 tests retargeted (§4, §16.1) | still dead — nothing calls it |
| `M2` | agent | `tools.ts`; the seven handler `ALLOWED_TOOLS` literals collapsed; `fasten.ts` passes `FASTEN_TOOLS` (§5) | still dead |
| `M3` | agent | `audit.ts`: tagged union, rotation, `ensureAuditDir` + `.vibe-racer/.gitignore`, boolean return, `auditLogPath` (§7) | still dead |
| `M4` | agent | `guard-hook.ts` + `session-options.ts` + `session.ts` wiring: hook under `hooks.PreToolUse`, `canUseTool` dropped, `tools` narrowing, banner downstream of `assertHookInstalled`; tier-2 wiring tests (§6, §8, §16.2) | **live.** This is the milestone that fixes the bug |
| `M5` | agent | `guard-preflight.ts`, the refusal renderer, both call sites, the exact SDK pin, the pin/constant drift test (§9, §15.1) | live + refuses |
| `M6` | agent | Denial surfaces: suppression, `summary()` printed at every call site incl. both `cleanup_ready` sessions, `radio`'s notice, `init`'s banner (§6.4, §14) | live |
| `M7` | agent | Heartbeat **detect** path: `sawToolUse`, `recordBypass`, the stream scan, `abortController`, `aborting` flag — with `HEARTBEAT_ABORTS = false` (warning-only) | live, heartbeat warns |
| `G2` | **operator** | Run `npm run test:live` (probes L1–L7 of §16.3, plus `L8` from Q2). **L5 — the three false-abort cases — is the blocking prerequisite.** Record each probe's result where `M8` can read it | — |
| `M8` | agent | Fork resolution. Probe clean ⇒ `HEARTBEAT_ABORTS = true`, `GuardBypassError`, the `withErrorHandling` branch, `commitPaths`, the two `state.yml` fields, the retry gate (§10, §12). `updateStage` must drop the two fields explicitly when it leaves `error`: today it spreads the whole state forward, so §12.3's "a successful retry clears the marker" is not something it does yet. Probe dirty and unnarrowable ⇒ record warning-only as the shipped behaviour and open the follow-up | live, heartbeat final |
| `G3` | **operator** | The dry run: a throwaway task through all seven laps in a scratch repo, driven by **this branch's build** — `node <task checkout>/dist/index.js drive`, the opposite binary from `G1`'s. Rebuild the task checkout first (`npm run build`) so `dist/` is the branch's head. Leave `.vibe-racer/audit.log` and one line per lap (completed / could not complete) | — |
| `M9` | agent | Classify and fix: every denial into one of F10's three outcomes; prompt fixes and any narrowing, each recorded with the denial that motivated it | live |
| `G4` | **operator** | Re-run only the laps whose prompt or rule `M9` changed. If none changed, tick without a run | — |
| `M10` | agent | The final per-lap table where the QA lap reads it; `SECURITY.md`, `docs/security.md`, `docs/how-it-works.md`, `CLAUDE.md`, README, CHANGELOG; this repo's `.gitignore` fix (§15.3) | live |

**Why `M1`–`M3` before `M4`.** Each is a refactor with **no runtime behaviour change at all** —
nothing calls the guard until `M4` wires it. That makes them the cheapest possible place to get the
decide-only seam, the tool table and the audit contract wrong and have `typecheck` plus tier-1 catch
it. Landing the hook first and refactoring underneath it would mean every mistake in `M1`–`M3`
arrives as a live denial on the next lap.

**Why `M5` after `M4`.** Pre-flight check 2 asserts `hooks.PreToolUse` is present on a real built
options object. It cannot pass before `M4` exists, so writing it first means landing a milestone
whose own test must be skipped.

**Why `M7` is warning-only and `M8` is a separate row.** F5 makes the live probe a blocking
prerequisite for the abort. Splitting detect from abort means `G2` gates one small, reversible
constant rather than a whole feature, and `M7`'s own tests (synthetic stream in, bypass entry out)
run without the probe.

---

### Q2: Are the three unnamed tool families pre-seeded, or discovered by the dry run?

`02_design.md` §19.1 names `TodoWrite`, `BashOutput` and `KillShell`: in context today because
`allowedTools` never filtered anything, in no lap's list, and about to become `tool-not-in-list`
denials the moment `M4` lands. F2's table leaves `TaskOutput`/`TaskStop`/`ToolSearch` to the dry
run. Do these three join that row, or do we let `G3` find them?

**Answer:**
**The three names in the question are not in this SDK's tool list, so none of them is seeded.**
`02_design.md` §19.1 took them from memory. The probe of 0.3.270 run while confirming issue #7 listed what a
session actually has in context:

```
Task, Bash, CronCreate, CronDelete, CronList, DesignSync, Edit, EnterWorktree, ExitWorktree, Glob,
Grep, ListAgents, Monitor, NotebookEdit, PushNotification, Read, RemoteTrigger, ReportFindings,
ScheduleWakeup, SendMessage, Skill, TaskOutput, TaskStop, ToolSearch, WebFetch, WebSearch,
Workflow, Write, mcp__…
```

No `TodoWrite`, no `BashOutput`, no `KillShell`. In this SDK the tools that read and stop a
backgrounded `Bash` are `TaskOutput` and `TaskStop`, which F2's table already names as candidates,
and there is no todo tool in context at all. This paragraph overrides §19.1 and §19.2 of the design.

What `M2` does instead:

- **Pre-seed `TaskOutput` and `TaskStop` wherever `Bash` is already listed** — `ready_to_execute`,
  `ai_qa`, `cleanup_ready` (cleanup session). Not on review laps, not on `fasten`, not on the
  decision session. This is E8's pre-authorised case, and §19.2's argument holds for these two
  names: without them a backgrounded `Bash` produces output nothing can read.
- **`ToolSearch` is not seeded.** It only matters if a lap needs a deferred tool, and every tool a
  lap lists is a core built-in. `G3` decides it, as F2 says.
- **Tool names are checked against the session, not against memory.** `M2` adds a tier-3 probe
  (`L8`) that reads the `tools` array of the `system/init` message at the pinned SDK and asserts
  every name in `TOOLS_BY_STAGE` appears in it. A name the SDK does not know is the same class of
  mistake as the one this answer corrects, and whether an unknown name in the `tools` option is
  ignored or rejected is unverified.

Each seeded tool gets a one-line comment in `tools.ts` naming E8 as its authority, so a later reader
does not mistake a pre-seeded candidate for a casually added tool. If `G3` shows a lap never uses
one, `M9` removes it in one line.

`fasten` stays exactly `Read, Glob, Grep` (§5.1).

---

### Q3: Is `G2` (the live tier) really an operator row, and what happens if `L5` comes back dirty?

`npm run test:live` is a test command, not a `drive` invocation — so unlike F10's dry run it is not
obviously outside an execute session's reach. But it starts real paid sessions. And `M8` branches on
its result, which means the plan has to carry both branches before anyone knows which one runs.

**Answer:**
**`G2` is an operator row.** F10's reason for the dry-run gate — "the spend is the operator's" —
applies unchanged to a suite that opens real sessions; the fact that it is reached through `vitest`
rather than through `drive` does not change who pays. The row's checklist is the seven probes of
§16.3 by ID (`L1`–`L7`) and Q2's `L8`, each with a result line, and it explicitly includes the `fasten` manual
check (`L7`) so §18.2's verification is not left to a release checklist no test touches.

**`M8` carries both branches in the plan, written before `G2` runs**, with the probe result selecting
one at execution time:

| `L5` outcome | `M8` ships |
|---|---|
| No false abort on any of the three cases | `HEARTBEAT_ABORTS = true` plus the full bypass contract: `GuardBypassError`, the `withErrorHandling` branch, `commitPaths`, the two `state.yml` fields, the retry gate |
| A false abort that one of §10.5's levers excludes (`parent_tool_use_id`, `agent_id`, `isSynthetic`) | the same, plus the lever as a one-line filter in the detect loop, and the excluded case named in `docs/security.md` |
| A false abort no lever excludes | **warning-only is the shipped behaviour.** `HEARTBEAT_ABORTS` stays `false`, the bypass contract is not written, `05_qa.md` records why, and the abort becomes its own follow-up task |

The third column is why the fork is cheap: `M7` already ships the detect path, the bypass audit entry
and the warning, so the "bad" outcome is a milestone that writes documentation rather than one that
removes code. **The guard itself ships in `M4` regardless** — no branch of `G2` can delay what
acceptance depends on.

If `G2` cannot run at all (no budget, no credentials), it is **not** ticked as "skipped": it becomes
the documented manual release step the objective allows ("What" bullet 4), `M8` takes the
warning-only branch, and the fact that the abort was never probed is stated in `05_qa.md`. An
unprobed abort is not shipped on its author's word.

---

## Driving this task while it changes `drive`

### Q4: Which vibe-racer binary drives this task's own remaining laps?

From `M4` onward, this branch's `src/` enforces a tool guard and narrows context. The remaining laps
of **this task** — `ai_qa`, `cleanup_ready` — plus every re-driven execute session are themselves
run by some vibe-racer. If that is `npm run dev` from the branch, the task starts enforcing its own
half-finished guard on itself, and a missing `TodoWrite` stalls the very session meant to add it. If
it is the installed 0.3.0, nothing this task writes affects how this task runs — at the cost of not
dogfooding the fix until `G3`.

**Answer:**
**Drive this task from a separate worktree of `main`, built once, for every lap from `G1` to
`done`. Dogfood the fix only in `G3`'s scratch repository.** `G1` is the first row of the table
(Q1) so this is enforced by a pause rather than remembered.

The "globally installed 0.3.0" the question offers does not exist on the machine this task runs on:
the global `vibe-racer` is a symlink to this checkout and runs `dist/index.js`. Every milestone ends
with `npm run build`, so the global binary **is** the branch's build from `M1` on, and a broken
build stops `drive` for this task and for every other project on the machine. Installing the real
0.3.0 from npm is not a way out either: it predates the Execution Status table and operator gates
(#5, on `main`, unreleased), which this plan depends on.

Three reasons to keep the driver fixed:

1. **Self-stalling is a real failure mode with a bad shape.** An execute session denied a tool it
   needs cannot fix the list, because fixing it means editing `tools.ts` with a `Write` the same
   session may also be denied. That is a stall `MAX_STALLED_SESSIONS` burns three sessions on before
   anyone sees why.
2. **`G3` exists precisely to be the dogfood run**, in a scratch repository, with a throwaway task,
   with the operator watching and the audit log read afterwards. Dogfooding mid-build duplicates it
   under worse conditions and with the task's own state at risk.
3. **A bisect stays readable.** If a later lap of this task misbehaves, "the pipeline running it
   changed under it at `M4`" is a confound that is free to avoid.

What this costs, stated:

- This task's own execute, QA and `done` sessions run **unguarded**, as every session has until
  now. The guard's first real use is `G3`.
- The `M5` pre-flight path is not exercised by this task's own laps. Covered by tier 2 (§16.2, four
  triggers) and by `G3`.
- While the task is in flight, any other project on this machine that runs the global `vibe-racer`
  gets the half-built guard. Use the worktree binary there too, or do not race other projects until
  this merges.

`03_plan.md` repeats the `G1` command line next to the table, and `06_decision.md` says to remove
the worktree (`git worktree remove ../vibe-racer-main`) after the merge.

---

## Test sequencing

### Q5: Does the test that would have caught this defect land before the fix or with it?

The assertion `"canUseTool" in options === false` plus "`hooks.PreToolUse` is present" is the one
pair that makes the original bug impossible to reintroduce silently (§16.5). Written with `M4` it is
a test that passed the first time it ran — which proves it compiles, not that it discriminates.

**Answer:**
**Write it one milestone early, as a failing test, and make the red-to-green transition the
acceptance evidence for `M4`.**

Concretely: `M3` ends by adding `tests/claude/session.test.ts`'s replacement with the two assertions
and a `it.fails(...)` marker (vitest's inverted expectation), so `npm run test` stays green at `M3`
while the file documents what is still broken. `M4` flips it to a plain `it(...)`. The diff of `M4`
therefore contains both the fix and the removal of the inversion — one commit in which the
discriminating power of the assertion is visible.

**This applies to exactly two assertions**, not to the suite. Test-first for everything would slow
ten milestones to buy nothing: the other tier-2 assertions are ordinary coverage and land with their
code. These two are different because they are the *regression* tests for a shipped security defect,
and a regression test that has never been red is a regression test on trust.

Two more sequencing rules for the same reason:

- **`M1` deletes `createToolGuard` in the same commit that retargets `tests/claude/guard.test.ts`.**
  Leaving the old entry point alive "until the tests move" means a window where both exist and the
  tests cover the dead one — which is the situation this task is fixing, in miniature.
- **The byte-identity message table (§16.1) is written in `M1` from the *current* source**, before
  any rule is touched. Written afterwards it records what the code says rather than what it said, and
  F1.3 ("messages unchanged") becomes unfalsifiable.

Every milestone still ends with `npm run build && npm run typecheck && npm run lint && npm run test`
green, per the objective's constraint. The `it.fails` marker is what keeps that true at `M3`.

---

## Docs, disclosure and the merge

### Q6: Is documentation one milestone at the end, and how is the README conflict handled?

Six documents name a mechanism that does not exist (`SECURITY.md`, `docs/security.md`,
`docs/how-it-works.md`, `CLAUDE.md`, README, CHANGELOG), plus an interim admonition the operator puts
on `main` **now**, outside the pipeline, which this branch must replace with permanent wording — and
which will therefore conflict at merge.

**Answer:**
**One documentation milestone, `M10`, after `G4`** — not spread across the build, and not first.

Why last: `M9` may change a prompt or narrow a rule, and `G4` may change it again. Docs written at
`M4` would describe the pre-dry-run rule set and need rewriting twice. Docs are the one artefact in
this task whose content is not known until the dry run is classified, so they are the one artefact
that belongs at the end. The three honest limits of `01_product.md` §2 and the two wrinkles of
`02_design.md` §4.4 and §11.4 land here too, as `docs/security.md` prose.

`M10`'s checklist, in one row:

- the exact dated line in `SECURITY.md` and `docs/security.md` — **"0.3.0 did not enforce the tool
  guard; earlier versions are unverified."** Not "since 0.1.0", not "a bug in 0.3.0 only";
- `docs/how-it-works.md`, `CLAUDE.md` and the README naming the `PreToolUse` mechanism, and the
  README's "two things the guard does not do" paragraph kept with its second half updated (F8.3);
- `docs/security.md` stating what the audit log may contain — denied commands and paths, verbatim —
  and why that is acceptable for a local ignored file (F6.6), plus the skill-probe session (E15) and
  the suppression wrinkle (§4.4);
- CHANGELOG: a **Security** entry for 0.3.0, a **Changed** line for the MCP/`Task`/`WebFetch`
  denial, and one line on mid-pipeline tasks;
- the README Security admonition rewritten from the interim warning into the permanent wording;
- this repository's `.gitignore`: `.viberacer/` → `.vibe-racer/`, and the `.viberacer-secrets` line
  checked against what `src/git/secrets.ts` actually reads.

**The merge conflict is handled by naming it, not by avoiding it.** `main` will have changed that
README paragraph after this branch was cut, so the conflict is expected, resolves **in favour of the
branch**, and is written into the `done` lap's `06_decision.md` so it is not a surprise at merge
time. Merging the task is what removes the interim warning — there is no version of `main` that has
the fix and still carries the warning, which is what makes the removal structural rather than
remembered (F9).

**Not rows in this table**, and `M10` must not pretend otherwise: merge, version bump, publish and
`npm deprecate vibe-racer@0.3.0`. Those are the operator's, after `done`.

---

# Complete

- [x] Ready to advance to Plan Review
