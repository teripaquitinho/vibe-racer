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
Ten agent milestones and three `Owner = operator` gate rows, in this order. Every gate is followed
by the milestone it unblocks (`tryAdvance`'s `trailingOperatorRows` check refuses a table that ends
on a gate), and no row merges, pushes, versions or publishes anything.

| Row | Owner | What lands | Enforcement state after it |
|---|---|---|---|
| `M1` | agent | `guard.ts` → `decideToolCall`, `GuardDecision`, `GuardRuleId`; `createToolGuard` and its `deny()` deleted; tier-1 tests retargeted (§4, §16.1) | still dead — nothing calls it |
| `M2` | agent | `tools.ts`; the seven handler `ALLOWED_TOOLS` literals collapsed; `fasten.ts` passes `FASTEN_TOOLS` (§5) | still dead |
| `M3` | agent | `audit.ts`: tagged union, rotation, `ensureAuditDir` + `.vibe-racer/.gitignore`, boolean return, `auditLogPath` (§7) | still dead |
| `M4` | agent | `guard-hook.ts` + `session-options.ts` + `session.ts` wiring: hook under `hooks.PreToolUse`, `canUseTool` dropped, `tools` narrowing, banner downstream of `assertHookInstalled`; tier-2 wiring tests (§6, §8, §16.2) | **live.** This is the milestone that fixes the bug |
| `M5` | agent | `guard-preflight.ts`, the refusal renderer, both call sites, the exact SDK pin, the pin/constant drift test (§9, §15.1) | live + refuses |
| `M6` | agent | Denial surfaces: suppression, `summary()` printed at every call site incl. both `cleanup_ready` sessions, `radio`'s notice, `init`'s banner (§6.4, §14) | live |
| `M7` | agent | Heartbeat **detect** path: `sawToolUse`, `recordBypass`, the stream scan, `abortController`, `aborting` flag — with `HEARTBEAT_ABORTS = false` (warning-only) | live, heartbeat warns |
| `G1` | **operator** | Run `npm run test:live` (probes L1–L7, §16.3). **L5 — the three false-abort cases — is the blocking prerequisite.** Record each probe's result where `M8` can read it | — |
| `M8` | agent | Fork resolution. Probe clean ⇒ `HEARTBEAT_ABORTS = true`, `GuardBypassError`, the `withErrorHandling` branch, `commitPaths`, the two `state.yml` fields, the retry gate (§10, §12). Probe dirty and unnarrowable ⇒ record warning-only as the shipped behaviour and open the follow-up | live, heartbeat final |
| `G2` | **operator** | The dry run: a throwaway task through all seven laps in a scratch repo with this branch linked. Leave `.vibe-racer/audit.log` and one line per lap (completed / could not complete) | — |
| `M9` | agent | Classify and fix: every denial into one of F10's three outcomes; prompt fixes and any narrowing, each recorded with the denial that motivated it | live |
| `G3` | **operator** | Re-run only the laps whose prompt or rule `M9` changed. If none changed, tick without a run | — |
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
prerequisite for the abort. Splitting detect from abort means `G1` gates one small, reversible
constant rather than a whole feature, and `M7`'s own tests (synthetic stream in, bypass entry out)
run without the probe.

---

### Q2: Are the three unnamed tool families pre-seeded, or discovered by the dry run?

`02_design.md` §19.1 names `TodoWrite`, `BashOutput` and `KillShell`: in context today because
`allowedTools` never filtered anything, in no lap's list, and about to become `tool-not-in-list`
denials the moment `M4` lands. F2's table leaves `TaskOutput`/`TaskStop`/`ToolSearch` to the dry
run. Do these three join that row, or do we let `G2` find them?

**Answer:**
**Pre-seed all three in `M2`, as explicitly commented candidates**, and let `G2` confirm rather than
discover:

- `BashOutput` and `KillShell` wherever `Bash` is already listed — `ready_to_execute`, `ai_qa`,
  `cleanup_ready` (cleanup session). Not on review laps, not on `fasten`, not on the decision
  session, none of which list `Bash`.
- `TodoWrite` on every lap, including the review laps and the decision session.

This is E8's pre-authorised case verbatim — "adding one where its parent tool is already allowed is
the only list change F10's third outcome may make" — and Q8's principle covers all three: none has
any reach of its own. `BashOutput` can read only what a `Bash` call the guard already approved
produced; `KillShell` can stop only such a call; `TodoWrite` writes to the session's own todo state,
not the filesystem.

**The cost of not doing it is asymmetric.** `TodoWrite` is called by agents on most multi-step work,
so leaving it out risks a `tool-not-in-list` denial on **every one of the seven dry-run laps** —
then `M9` adds the three tools, `G3` re-runs all seven, and we have paid for fourteen laps to learn
what reading the SDK's tool list told us for free. The reverse error is cheap and visible: if `G2`
shows a lap never touches `TodoWrite`, `M9` removes it in one line.

`fasten` stays exactly `Read, Glob, Grep` — it lists no `Bash`, writes nothing, and its report comes
back as session text (§5.1).

Each of the three gets a one-line comment in `tools.ts` naming E8 as its authority, so a later reader
does not mistake a pre-seeded candidate for a casually added tool.

---

### Q3: Is `G1` (the live tier) really an operator row, and what happens if `L5` comes back dirty?

`npm run test:live` is a test command, not a `drive` invocation — so unlike F10's dry run it is not
obviously outside an execute session's reach. But it starts real paid sessions. And `M8` branches on
its result, which means the plan has to carry both branches before anyone knows which one runs.

**Answer:**
**`G1` is an operator row.** F10's reason for the dry-run gate — "the spend is the operator's" —
applies unchanged to a suite that opens real sessions; the fact that it is reached through `vitest`
rather than through `drive` does not change who pays. The row's checklist is the seven probes of
§16.3 by ID (`L1`–`L7`), each with a result line, and it explicitly includes the `fasten` manual
check (`L7`) so §18.2's verification is not left to a release checklist no test touches.

**`M8` carries both branches in the plan, written before `G1` runs**, with the probe result selecting
one at execution time:

| `L5` outcome | `M8` ships |
|---|---|
| No false abort on any of the three cases | `HEARTBEAT_ABORTS = true` plus the full bypass contract: `GuardBypassError`, the `withErrorHandling` branch, `commitPaths`, the two `state.yml` fields, the retry gate |
| A false abort that one of §10.5's levers excludes (`parent_tool_use_id`, `agent_id`, `isSynthetic`) | the same, plus the lever as a one-line filter in the detect loop, and the excluded case named in `docs/security.md` |
| A false abort no lever excludes | **warning-only is the shipped behaviour.** `HEARTBEAT_ABORTS` stays `false`, the bypass contract is not written, `05_qa.md` records why, and the abort becomes its own follow-up task |

The third column is why the fork is cheap: `M7` already ships the detect path, the bypass audit entry
and the warning, so the "bad" outcome is a milestone that writes documentation rather than one that
removes code. **The guard itself ships in `M4` regardless** — no branch of `G1` can delay what
acceptance depends on.

If `G1` cannot run at all (no budget, no credentials), it is **not** ticked as "skipped": it becomes
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
dogfooding the fix until `G2`.

**Answer:**
**Drive this task with the globally installed vibe-racer (0.3.0, unguarded) for all of `M1`–`M10`,
and dogfood the fix only in `G2`'s scratch repository.** Record this as an explicit line in
`03_plan.md`, because the default — `npm run dev` in the repo you are editing — is the hazardous one
and nobody will remember which they used.

Three reasons:

1. **Self-stalling is a real failure mode with a bad shape.** An execute session denied a tool it
   needs cannot fix the list, because fixing it means editing `tools.ts` with a `Write` the same
   session may also be denied. That is a stall `MAX_STALLED_SESSIONS` burns three sessions on before
   anyone sees why.
2. **`G2` exists precisely to be the dogfood run**, in a scratch repository, with a throwaway task,
   with the operator watching and the audit log read afterwards. Dogfooding mid-build duplicates it
   under worse conditions and with the task's own state at risk.
3. **A bisect stays readable.** If a later lap of this task misbehaves, "the pipeline running it
   changed under it at `M4`" is a confound that is free to avoid.

The one thing this costs: the `M5` pre-flight code path is not exercised by this task's own laps.
Covered by tier-2 (§16.2, four triggers) and by `G2`, which runs the real thing.

**If struck** — if the preference is to dogfood from `M4` — then `M2` must pre-seed the three tool
families of Q2 (not merely propose them), `G2` moves to immediately after `M4`, and `03_plan.md`
should say that a self-stall is resolved by the operator running the next lap with the global binary
rather than by widening a list under pressure.

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
**One documentation milestone, `M10`, after `G3`** — not spread across the build, and not first.

Why last: `M9` may change a prompt or narrow a rule, and `G3` may change it again. Docs written at
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

- [ ] Ready to advance to Plan Review
