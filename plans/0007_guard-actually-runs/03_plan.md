# Implementation Plan — #7: guard-actually-runs

> **Role**: Senior Software Engineer
> **Stage**: `ai_plan_review` → `need_execution`
> **Date**: 2026-10-12
> **Source answers**: `03_plan_questions.md` Q1–Q6 (all answered and ticked)
> **Upstream**: `02_design.md` §4–§21 (module contracts), `01_product.md` F1–F10 + §17 acceptance, `00_objective.md` C1–C4
> **Baseline**: 34 test files / 675 tests green; SDK 0.3.270 installed; branch `vibe-racer/0007_guard-actually-runs`

---

## Table of contents

1. [Implementation strategy](#1-implementation-strategy)
2. [Milestone overview](#2-milestone-overview)
3. [G1 — Build the driver worktree](#g1--build-the-driver-worktree)
4. [M1 — `guard.ts` becomes a decision core](#3-m1--guardts-becomes-a-decision-core)
5. [M2 — `tools.ts`, one list from one place](#4-m2--toolsts-one-list-from-one-place)
6. [M3 — `audit.ts` becomes evidence](#5-m3--auditts-becomes-evidence)
7. [M4 — The fix: the hook runs](#6-m4--the-fix-the-hook-runs)
8. [M5 — Pre-flight refusal and the SDK pin](#7-m5--pre-flight-refusal-and-the-sdk-pin)
9. [M6 — Denial surfaces and honest banners](#8-m6--denial-surfaces-and-honest-banners)
10. [M7 — Heartbeat, detect-only](#9-m7--heartbeat-detect-only)
11. [G2 — Run the live probe suite](#g2--run-the-live-probe-suite)
12. [M8 — Fork resolution: the bypass contract](#10-m8--fork-resolution-the-bypass-contract)
13. [G3 — The dry run](#g3--the-dry-run)
14. [M9 — Classify and fix](#11-m9--classify-and-fix)
15. [G4 — Re-run what changed](#g4--re-run-what-changed)
16. [M10 — Docs, disclosure and housekeeping](#12-m10--docs-disclosure-and-housekeeping)
17. [Dependency graph](#13-dependency-graph)
18. [Test strategy](#14-test-strategy)
19. [Plan-level decisions](#15-plan-level-decisions)
20. [Traceability: acceptance → milestone](#16-traceability-acceptance--milestone)
21. [Closing note — what happens after the last milestone](#17-closing-note--what-happens-after-the-last-milestone)

---

## 1. Implementation strategy

### The build order in one sentence

**Three behaviour-neutral refactors, then the one milestone that makes enforcement live, then the
surfaces that depend on it being live, then two paid operator gates and the two milestones that
read their results.**

```
G1 driver worktree         (operator — costs no session)
 |
M1 guard.ts  -> decideToolCall                     refactor, nothing calls it
M2 tools.ts  -> one list, seven literals gone      refactor, nothing enforces it
M3 audit.ts  -> union + rotation + self-ignore     refactor, nothing writes through it
 |                                                 + the red wiring test (it.fails)
M4 guard-hook.ts + session-options.ts   *** THE FIX — enforcement is live here ***
 |
M5 guard-preflight.ts + the exact SDK pin          live + refuses
M6 suppression, summary, radio + init notices      live + legible
M7 heartbeat DETECT only (HEARTBEAT_ABORTS=false)  live + warns
 |
G2 npm run test:live  (operator — L1..L9; L5 is the blocking prerequisite)
M8 fork resolution: abort + bypass contract, or warning-only shipped
 |
G3 seven-lap dry run  (operator — this branch's build, scratch repo)
M9 classify every denial; prompt fixes and any narrowing
 |
G4 re-run only the laps M9 changed  (operator)
M10 docs, disclosure, CHANGELOG, .gitignore
```

### Why `M1`–`M3` land before `M4`

Each of the three is a refactor with **no runtime behaviour change at all** — nothing calls the
guard until `M4` wires it. That makes them the cheapest possible place to get the decide-only seam,
the tool table and the audit contract wrong and have `typecheck` plus tier-1 catch it. Landing the
hook first and refactoring underneath it would mean every mistake in `M1`–`M3` arrives as a live
denial on the next lap (Q1).

### Why `M5` comes after `M4`

Pre-flight check 2 asserts `hooks.PreToolUse` is present on a **real built options object**
(`02_design.md` §9.2). It cannot pass before `M4` exists, so writing it first means landing a
milestone whose own test must be skipped (Q1).

### Why `M7` is detect-only and `M8` is a separate row

`01_product.md` F5 makes the live probe of the three false-abort cases a **blocking prerequisite**
for the abort. Splitting detect from abort means `G2` gates one small, reversible constant
(`HEARTBEAT_ABORTS`) rather than a whole feature, and `M7`'s own tests (synthetic stream in, bypass
entry out) run without the probe. **The guard itself ships in `M4` regardless** — no branch of `G2`
can delay what acceptance depends on (Q1, Q3).

### Why docs are last

`M9` may change a prompt or narrow a rule, and `G4` may change it again. Docs written at `M4` would
describe the pre-dry-run rule set and need rewriting twice. Documentation is the one artefact in
this task whose content is not known until the dry run is classified (Q6).

### The seven hazards this plan handles explicitly

| # | Hazard | Where it is handled |
|---|---|---|
| **H1** | `M1` deletes `createToolGuard`, which is `session.ts`'s only guard call. For `M1`–`M3` the sessions are *provably* unguarded — and the `Guard:` banner would then describe enforcement that is not installed, on this branch, for three milestones | `M1` removes the banner print together with the dead wiring (F7.1 applies to the branch, not only to the release). `M4` reinstates it **downstream of `assertHookInstalled`**. No shim, no adapter, no "kept for reference" comment |
| **H2** | Q5 wants the two regression assertions red at `M3` and green at `M4`. But `M1` already removed `canUseTool`, so the `canUseTool`-is-absent half **passes** at `M3` — an `it.fails` over that assertion alone would fail the suite | One `it.fails` test carrying **both** assertions. It throws at `M3` because `hooks.PreToolUse` is absent, so the inversion is honest, and `M4` flips it to a plain `it(...)`. See §15 D2 |
| **H3** | Rule order. If membership (`tool-not-in-list`) is evaluated before the review-stage `Bash` rule, rule 1 becomes unreachable, its message silently changes, and `bash-review-stage` dies as a rule | `M1` task 3 fixes the order (review-stage Bash at 1, membership at 2) and `M1`'s test requirements make the order itself an assertion. `02_design.md` §4.2 calls this the single most invertible line in the module |
| **H4** | The binary that drives this task. Every milestone ends with `npm run build`, and the global `vibe-racer` is a symlink to this checkout — so from `M1` on, the global CLI *is* this branch's half-built guard | `G1` is the first row: a worktree of `main`, built once, drives every lap from `G1` to `done`. Q4's three reasons are restated in `G1`'s section. `06_decision.md` removes the worktree after the merge |
| **H5** | Tool names checked against memory rather than against the SDK. `02_design.md` §19.1 named three tools (`TodoWrite`, `BashOutput`, `KillShell`) that **do not exist in this SDK** | `M2` seeds only `TaskOutput`/`TaskStop` (Q2) and adds probe `L8`, which reads the `tools` array of the `system`/`init` message and asserts every name in `TOOLS_BY_STAGE` appears in it |
| **H6** | `G2`'s result selects which `M8` ships. A plan that carries one branch has to be rewritten mid-execution | `M8` carries all three branches, written before `G2` runs (Q3). The fork is a boolean plus one unreachable code path, not a redesign |
| **H7** | `G3` leaves an audit log as evidence, and `commitAll` runs the secret scanner over everything staged. A denied `Bash` command containing a key-shaped string would block the milestone commit | `G3`'s checklist tells the operator to redact before copying, and `M9` task 8 names the fallback: if `scanFiles` flags the evidence file, summarise it in `04_dry_run.md` and delete the raw copy |

### Reuse posture

**Reused unchanged — no milestone touches these:** `src/pipeline/markdown-scan.ts` and both its
readers (`execute-table.ts`, `operator-block.ts`), `src/pipeline/states.ts`'s stage machinery
(`STAGE_ORDER`, `NON_LINEAR_STAGES`, `STAGE_QUESTIONS_FILE`), `src/pipeline/validation.ts`
(`ensureCompletionSection`), `src/claude/prompts.ts`'s prompt bodies (except the prompt fixes `M9`
may make), `src/git/secrets.ts`, `src/config/*`.

**Reused by extension:**

| Existing code | How it is extended, and by which milestone |
|---|---|
| `src/claude/guard.ts` — every rule, every message, `formatGuardSummary` | `M1`: same rule bodies, same message strings, re-seamed as `decideToolCall`. `createToolGuard` deleted in the same commit as its tests |
| `src/claude/audit.ts` — `appendAuditEntry`, the 1 MB cap, the `statSync` | `M3`: same function, same one-JSON-object-per-line format; gains a discriminator, a boolean return and rotation on the `statSync` that is already there |
| `src/claude/skills.ts` — `LAP_BY_STAGE`, `resolveSkills`, `partitionSkills` | `M2`/`M4`: `withSkill` is derived from the existing resolution result; the `[...tools, "Skill"]` splice at `session.ts:89` moves into `toolsForSession` |
| `src/pipeline/states.ts` — `STAGE_NEXT_NAME`, the human-facing label map | `M5`: `LAP_LABEL` joins it, next to the map it is a sibling of (§15 D4) |
| `src/git/operations.ts` — `createGit`, `commitAll`, the `scanFiles` pre-commit scan | `M5`: `isPathTracked`. `M8`: `commitPaths` (partial commit, same secret scan), `isTreeClean` |
| `src/state/store.ts` — `setError`'s salvage path, `updateStage` | `M8`: `setError` gains an optional fourth parameter rather than a second function; `updateStage` learns to drop the bypass fields |
| `src/utils/logger.ts` — `log.warn`, `log.guard`, `log.dim` | throughout. No new logging surface |
| `src/cli/index.ts` — the `package.json` version import | `M7`: moved to `src/version.ts` and imported from there by both consumers (consolidation, not a second import site) |

**Genuinely new, with no existing equivalent:** `src/claude/guard-hook.ts` (per-session run),
`src/claude/tools.ts` (the lap's tool list), `src/claude/session-options.ts` (one options object),
`src/claude/guard-preflight.ts` (refusing before spend), `src/version.ts` (three lines),
`vitest.live.config.ts` + `tests/live/**` (the opt-in tier).

**Deleted, not deprecated:** `createToolGuard` and its inner `deny()`; the unconditional `Skill`
allow (`guard.ts:363`); the seven `ALLOWED_TOOLS` literals; the SDK `allowedTools` option; the two
`canUseTool` cases in `tests/claude/session.test.ts`; the "skips write when file exceeds 1 MB" audit
test.

---

## 2. Milestone overview

| # | Name | Key output | Depends on | Enforcement state after it |
|---|---|---|---|---|
| **G1** | Build the driver worktree | `../vibe-racer-main/dist/index.js` built from `main` | — | unchanged — and the pipeline driving this task now stays unchanged too |
| **M1** | `guard.ts` becomes a decision core | `decideToolCall`, `GuardDecision`, `GuardRuleId`; `createToolGuard` gone | G1 | still dead — nothing calls it |
| **M2** | `tools.ts`, one list from one place | `TOOLS_BY_STAGE`, `DECISION_TOOLS`, `FASTEN_TOOLS`, `toolsForSession`; seven literals gone; live-tier scaffolding + `L8` | M1 | still dead |
| **M3** | `audit.ts` becomes evidence | tagged union, rotation, `ensureAuditDir`, `auditLogPath`, boolean return; **the red wiring test** | M1 | still dead |
| **M4** | **The fix: the hook runs** | `guard-hook.ts`, `session-options.ts`, `hooks.PreToolUse`, `canUseTool` dropped, `tools` narrowing, banner after the assert | M1, M2, M3 | **live. This is the milestone that fixes the bug** |
| **M5** | Pre-flight refusal and the SDK pin | `guard-preflight.ts`, the refusal renderer, two call sites, exact pin, drift test | M4 | live + refuses |
| **M6** | Denial surfaces and honest banners | suppression, `summary()`, end-of-lap block, `radio` notice, `init` banner | M4 | live + legible |
| **M7** | Heartbeat, detect-only | `sawToolUse` consumed, `recordBypass`, stream scan, `abortController`, `HEARTBEAT_ABORTS = false` | M4, M6 | live, heartbeat warns |
| **G2** | Run the live probe suite | `04_live_probes.md` with a result line per probe `L1`–`L9` | M7 | — |
| **M8** | Fork resolution: the bypass contract | abort + `GuardBypassError` + wrapper branch + `commitPaths` + retry gate — **or** warning-only, recorded | G2 | live, heartbeat final |
| **G3** | The dry run | `04_dry_run.md` (one line per lap) + the scratch repo's audit log | M8 | — |
| **M9** | Classify and fix | every denial in one of F10's three outcomes; prompt fixes and any narrowing | G3 | live |
| **G4** | Re-run what changed | a `## G4` section in `04_dry_run.md` | M9 | — |
| **M10** | Docs, disclosure and housekeeping | six documents, the CHANGELOG, this repo's `.gitignore`, the final per-lap table | G4 | live |

**Every milestone ends green on all four gates:**

```bash
npm run build && npm run typecheck && npm run lint && npm run test
```

---

## G1 — Build the driver worktree

**Why this is a gate, and why it is first.** From `M1` onward this branch's `src/` is a half-built
guard, and every milestone ends with `npm run build` — which overwrites the exact `dist/` bundle the
globally linked `vibe-racer` runs. Driving this task with its own output means the task starts
enforcing its own unfinished guard on itself: an execute session denied a tool it needs cannot fix
the list, because fixing it means editing `tools.ts` with a `Write` the same session may also be
denied. That is a stall `MAX_STALLED_SESSIONS` burns sessions on before anyone sees why (Q4).

A planned gate costs **no session** (`decideNextStep` pauses before starting one), so this pause is
free.

- [ ] From the repository root, create a worktree of `main`: `git worktree add ../vibe-racer-main main`
- [ ] Build it once: `cd ../vibe-racer-main && npm ci && npm run build`
- [ ] Confirm `../vibe-racer-main/dist/index.js` exists and that the worktree is on `main`
- [ ] From here to `done`, drive **this** task with the worktree binary, run from the task checkout: `node ../vibe-racer-main/dist/index.js drive`
- [ ] Do not race other projects on this machine with the global `vibe-racer` until this task merges — it is this branch's build. Use the worktree binary there too, or wait

**Verification:** `git worktree list | grep -F vibe-racer-main && test -f ../vibe-racer-main/dist/index.js`

**What this costs, stated (Q4):** this task's own execute, QA and `done` sessions run **unguarded**,
as every session has until now; the guard's first real use is `G3`. The `M5` pre-flight path is not
exercised by this task's own laps — it is covered by tier 2 (four triggers) and by `G3`.

---

## 3. M1 — `guard.ts` becomes a decision core

### Goal

`src/claude/guard.ts` performs **no I/O and imports no SDK type**: one synchronous
`decideToolCall(options)(toolName, input)` returning a `GuardDecision`, carrying every rule that is
there today, with byte-identical messages and a stable rule id per rule. `createToolGuard` is
deleted in the same commit that retargets its tests.

### Code reuse

- **Reused verbatim**: `realpathIfExists`, `resolveToolPath`, `isWithinAllowed`, `isSensitivePath`,
  `extractPath`, `checkInterpreterNetworkCall`, `checkBashCommand` and every constant
  (`BASH_BLOCKLIST`, `PLAN_JAILED_STAGES`, `BASH_BLOCKED_STAGES`, `SENSITIVE_PATHS`,
  `SENSITIVE_ABSOLUTE`, `NETWORK_SIGNATURES`, `INTERPRETER_EXEC_FLAGS`, `PATH_TOOLS`). No rule body
  is rewritten; the rule bodies move into a new dispatcher in the order `02_design.md` §4.2 fixes.
- **Extended**: `formatGuardSummary` — second parameter renamed `allowedTools` to `tools` and
  widened to `readonly string[]`. Its body is unchanged; it still mirrors rule 7's condition exactly
  (F7.4).
- **New**: the `GuardRuleId` / `GuardDecision` types and the dispatcher that returns them.

### Tasks

1. **Write the byte-identity message table first, from the current source** (Q5). Add
   `tests/claude/guard-messages.test.ts` holding the message strings copied out of
   `src/claude/guard.ts` *as it is at `HEAD`* — `state.yml is owned by the pipeline`,
   `sensitive path`, `path outside project directory`, `file may contain secrets`,
   `writes restricted to <taskPlanPath>/`, `review stage: bash not permitted`,
   `Blocked command: <cmd>`, `Blocked command: destructive rm`,
   `Interpreter network call: <interp> inline code with <sig>`,
   `References sensitive path: <match>`, `References path outside project: <match>`,
   `Internal guard error: <msg>` — and the `Denied: ${tool} ${input} — ${reason}` assembly string.
   Run it green against `createToolGuard` **before** task 3 touches anything. Written afterwards it
   records what the code says rather than what it said, and F1.3 becomes unfalsifiable.
2. Add the public types to `src/claude/guard.ts`:
   ```ts
   export type GuardRuleId =
     | "state-yml" | "sensitive-path" | "path-jail" | "dotenv" | "plan-jail"
     | "bash-review-stage" | "bash-blocklist" | "bash-network"
     | "tool-not-in-list" | "internal-error";

   export type GuardDecision =
     | { behavior: "allow" }
     | { behavior: "deny"; tool: string; input: string; reason: string; rule: GuardRuleId };
   ```
   and extend `GuardOptions` with `tools: readonly string[]` (required; the lap's list — a tool
   outside it is `tool-not-in-list`). `jailToPlanDir?: boolean` keeps its existing doc comment.
3. Implement
   `export function decideToolCall(options: GuardOptions): (toolName: string, input: Record<string, unknown>) => GuardDecision`.
   **Synchronous** — nothing in the rule body awaits; the hook wrapper is the `async` boundary.
   Rule order, exactly (`02_design.md` §4.2):

   | # | Rule | `rule` | Condition |
   |---|---|---|---|
   | 1 | review-stage Bash | `bash-review-stage` | `BASH_BLOCKED_STAGES.has(stage) && tool === "Bash"` |
   | 2 | membership | `tool-not-in-list` | `!options.tools.includes(tool)`, reason `not available at this stage (<stage>)` |
   | 3 | state.yml | `state-yml` | Write/Edit, basename `state.yml`, under `plansDir` |
   | 4 | sensitive path | `sensitive-path` | path-bearing tool, `isSensitivePath` |
   | 5 | path containment | `path-jail` | path-bearing tool, `!isWithinAllowed` |
   | 6 | dotenv | `dotenv` | basename matches `^\.env(\..+)?$` |
   | 7 | plan jail | `plan-jail` | Write/Edit and (`jailToPlanDir` or `PLAN_JAILED_STAGES.has(stage)`) |
   | 8 | Bash filter | see task 4 | `checkBashCommand` |
   | — | default | — | `{ behavior: "allow" }` |
   | — | `catch` | `internal-error` | any throw above; `input` is `JSON.stringify(input)` as today |

   **Rule 1 before rule 2 is load-bearing** (H3): no review lap lists `Bash`, so with membership
   first rule 1 is unreachable and its message silently becomes the membership message.
4. Change the internal Bash helpers' return type from `PermissionResult` to
   `{ deny: false } | { deny: true; reason: string; rule: GuardRuleId }`, and map the four messages
   per `02_design.md` §4.3: `Blocked command: ...` to `bash-blocklist`,
   `Interpreter network call: ...` to `bash-network`, `References sensitive path: ...` to
   **`sensitive-path`**, `References path outside project: ...` to **`path-jail`** — the id names the
   rule, and `tool` already distinguishes the `Bash` route from the `Read`/`Write` route.
5. **Delete** `createToolGuard`, its inner `deny()`, the unconditional
   `if (toolName === "Skill") return allow` (`guard.ts:363`), and the imports `CanUseTool`,
   `PermissionResult`, `log`, `appendAuditEntry`. After this the file imports `node:fs`,
   `node:path`, `node:os` and `type { Stage }` only.
6. `export` the rule constants listed under Code reuse (they are module-private today) so
   `guard-hook.ts`, `formatGuardSummary` and the tests read one definition.
7. Rename `formatGuardSummary`'s second parameter to `tools: readonly string[]`.
8. **`src/claude/session.ts`** — remove the dead wiring with the dead function (H1): delete the
   `createToolGuard` import and call, the `canUseTool` local and the `canUseTool` key in the `query`
   options, **and** the `log.guard(formatGuardSummary(...))` call at `session.ts:39`. The commit
   message states that the hook wiring and the banner return in `M4`, downstream of
   `assertHookInstalled`. `options.allowedTools` keeps being passed to the SDK, unchanged, as the
   no-op it has always been under `bypassPermissions` — `M2` moves where the value comes from and
   `M4` replaces the option (§15 D3).
9. Retarget `tests/claude/guard.test.ts` (1030 lines) from `createToolGuard` onto `decideToolCall`
   **in this commit** (Q5): the call becomes synchronous, every case passes a `tools` list, and
   message assertions become `expect(d.rule).toBe(...)` except in the table test from task 1.
   Delete the two `canUseTool` cases in `tests/claude/session.test.ts` (`session.test.ts:76`,
   `:112`) — they assert a parameter that no longer exists. Their coverage (the `runAndStream` to
   guard to plan-jail chain for `jailToPlanDir`) is restored through the hook in `M4`'s rewritten
   file; this is the one recorded coverage dip in the task.

### Test requirements

`tests/claude/guard.test.ts` (retargeted), `tests/claude/guard-messages.test.ts` (new):

- Every `GuardRuleId` is reachable, asserted by id.
- The two reused ids are asserted **from both routes**: `path-jail` from `Write` with an outside
  path and from `Bash` referencing one; `sensitive-path` from `Read` of `~/.ssh/id_rsa` and from
  `Bash` referencing it.
- **Rule order**: `Bash` at `ai_product_review` with `tools` not containing `Bash` yields
  `bash-review-stage`, never `tool-not-in-list`.
- Membership: a tool in the list is unaffected (rules 3–8 fire exactly as today); a tool outside it
  denies with `tool-not-in-list` and a reason naming the stage.
- `Skill` is **not** specially allowed: `Skill` with `tools: ["Read"]` denies `tool-not-in-list`;
  with `tools: ["Read", "Skill"]` it allows.
- Byte-identity: each message string in task 1, and the `Denied: ...` assembly, unchanged.
- Leaf property: a test reads `src/claude/guard.ts` and asserts every `import` line names
  `node:fs`, `node:path`, `node:os` or `../state/schema.js` — the technique `markdown-scan.ts` is
  protected by.
- `formatGuardSummary` keeps its four existing cases (jailed, unjailed, blocked-bash, blocklist
  count) green under the renamed parameter.

---

## 4. M2 — `tools.ts`, one list from one place

### Goal

One table owns every lap's tool list; the seven literals scattered through the handlers are gone;
the live tier exists and its first probe checks the tool names against the SDK rather than against
memory.

### Code reuse

- **Extended**: `session.ts`'s `[...(options.allowedTools ?? []), "Skill"]` splice (`session.ts:89`)
  becomes `toolsForSession({ stage, override, withSkill })`; the `skillsRequested && skillsSection`
  condition already computed there is what feeds `withSkill`.
- **Pattern followed**: `TOOLS_BY_STAGE` is shaped exactly like `LAP_BY_STAGE` in `skills.ts` —
  `Partial<Record<Stage, ...>>`, one entry per agent stage, with the same "the bijection is what
  lets `runAndStream` derive it from `stage`" rationale.
- **New**: `src/claude/tools.ts`, `vitest.live.config.ts`, `tests/live/`.

### Tasks

1. Create `src/claude/tools.ts` — imports the `Stage` type and nothing else:
   ```ts
   export const TOOLS_BY_STAGE: Partial<Record<Stage, readonly string[]>> = {
     ai_objective_review: ["Read", "Glob", "Grep", "Write"],
     ai_product_review:   ["Read", "Glob", "Grep", "Write"],
     ai_design_review:    ["Read", "Glob", "Grep", "Write"],
     ai_plan_review:      ["Read", "Glob", "Grep", "Write"],
     // TaskOutput/TaskStop: E8 pre-authorised — no reach beyond the Bash call they read and stop.
     ready_to_execute: ["Read", "Glob", "Grep", "Write", "Edit", "Bash", "TaskOutput", "TaskStop"],
     ai_qa:            ["Read", "Glob", "Grep", "Write", "Bash", "TaskOutput", "TaskStop"],
     cleanup_ready:    ["Read", "Glob", "Grep", "Write", "Edit", "Bash", "TaskOutput", "TaskStop"],
   } as const;

   /** The second `cleanup_ready` session. Stage alone cannot tell them apart — see jailToPlanDir. */
   export const DECISION_TOOLS: readonly string[] = ["Read", "Glob", "Grep", "Write"];

   /** `fasten` is not a lap. Read-only, per 01_product.md §18.2. */
   export const FASTEN_TOOLS: readonly string[] = ["Read", "Glob", "Grep"];

   export function toolsForSession(opts: {
     stage: Stage;
     override?: readonly string[];
     withSkill?: boolean;
   }): readonly string[];
   ```
   `toolsForSession` returns a **frozen** array (`Object.freeze`), appends `"Skill"` when
   `withSkill`, prefers `override` over the stage entry, and returns a frozen `[]` for a stage with
   neither. An empty list is not a bug to tolerate: the hook then denies everything and the session
   is useless, which is strictly safer than a permissive fallback.
   **Not seeded** (Q2, overriding `02_design.md` §19.1 and §19.2): `TodoWrite`, `BashOutput` and
   `KillShell` are **not tools in this SDK**. `ToolSearch` is left to `G3`.
2. `src/claude/session.ts`: rename `SessionOptions.allowedTools?: string[]` to
   `tools?: readonly string[]` (the override), and compute the effective list once —
   `toolsForSession({ stage, override: options.tools, withSkill: skillsRequested && skillsSection !== "" })`.
   Keep passing it to the SDK as `allowedTools` for now: unchanged no-op semantics, and `M4`
   replaces the option with `tools` in the same commit as the narrowing it enables (§15 D3).
3. Delete the seven literals and their `allowedTools:` arguments:
   `src/pipeline/handlers/qa.ts:17`, `done.ts:11`, `done.ts:12`, `review-runner.ts:12`,
   `objective-review.ts:10`, `execute.ts:61`, `src/claude/fasten.ts:114`. After this a handler
   passes **no tool list at all** for the common case; `done.ts`'s decision session passes
   `tools: DECISION_TOOLS` and `fasten.ts` passes `tools: FASTEN_TOOLS`.
4. Update the handler tests that assert the old option:
   `tests/pipeline/handlers/qa.test.ts:164`, `tests/pipeline/handlers/done.test.ts:77`,
   `tests/claude/fasten.test.ts:91`–`:98` — the first two assert that **no** tool list is passed for
   the stage-derived case and that the decision session passes `DECISION_TOOLS`; the third that
   `fasten` passes `FASTEN_TOOLS`.
5. Live-tier scaffolding (its first consumer is this milestone's `L8`):
   - `vitest.live.config.ts` — `include: ["tests/live/**"]`, a long `testTimeout`, and
     `setupFiles: ["tests/live/setup.ts"]`.
   - `tests/live/setup.ts` — installs the `process.on("warning")` listener for `CLAUDE_SDK_*`
     codes, described in a comment as a **regression canary, not a detection layer**
     (`02_design.md` §11.5). It lives only here: in tiers 1–2 `query` is mocked and the SDK code
     that emits the warning never runs.
   - `package.json`: `"test:live": "VIBE_RACER_LIVE=1 vitest run --config vitest.live.config.ts"`.
   - `tests/live/guard-live.ts` — a `requireLive()` helper that **skips** (never fails) every live
     test unless `process.env.VIBE_RACER_LIVE === "1"`, so a stray `vitest` invocation cannot spend
     money, plus a `scratchDir()` helper that makes a `mkdtempSync` cwd.
6. `tests/live/tool-names.live.test.ts` — **probe `L8`** (Q2): start one real session **without the
   `tools` option** (a narrowed session lists only its own narrowed tools, so names from every other
   lap would be reported missing), read the `tools` array of the `system`/`init` message, and assert
   that every name in `TOOLS_BY_STAGE`, `DECISION_TOOLS` and `FASTEN_TOOLS`, plus `Skill`, appears
   in it. Whether an unknown
   name in the `tools` option is ignored or rejected is unverified, which is exactly why this probe
   exists.

### Test requirements

`tests/claude/tools.test.ts` (new, tier 1):

- Every agent stage has a `TOOLS_BY_STAGE` entry, so the empty case cannot be reached by a stage
  that should have had one.
- `Skill` is present iff `withSkill`; `override` wins over the stage entry; the returned array is
  frozen; an unknown stage with no override returns `[]`.
- `Grep` and `Glob` appear in **every** list (F2.3 — native builds may otherwise route search
  through `Bash`).
- No list contains `Task`, `WebFetch`, `WebSearch`, `ToolSearch` or any `mcp__` name (F2's
  baseline, asserted as a negative so a casual addition fails the suite).
- `FASTEN_TOOLS` through `decideToolCall`: `Write` and `Edit` deny with `tool-not-in-list`; `Read`
  allows.
- `TaskOutput` and `TaskStop` are present exactly where `Bash` is, and nowhere else.

`tests/claude/session.test.ts` (extended): the list `runAndStream` resolves for `ai_qa` equals
`TOOLS_BY_STAGE.ai_qa` plus `Skill` when a skill resolved, and equals it without `Skill` when none
did.

**Completion test for this milestone:** `grep -rn '"Read", "Glob", "Grep"' src/pipeline/ src/claude/fasten.ts`
returns nothing.

---

## 5. M3 — `audit.ts` becomes evidence

### Goal

The audit log becomes a contract: one definition of its path, a directory that ignores itself,
rotation instead of silent loss, a discriminator on every entry, and a return value the caller can
act on. This milestone also lands the **red** wiring test that `M4` turns green.

### Code reuse

- **Extended, not replaced**: `appendAuditEntry` keeps its name, its one-JSON-object-per-line
  format, its `mkdirSync`, its `statSync` and its never-throws contract. The rotation trigger is the
  `statSync` already in the function — no extra syscall per entry.
- **New**: `auditLogPath`, `ensureAuditDir`, the `AuditEntry` union, the exported `MAX_AUDIT_SIZE`.

### Tasks

1. `src/claude/audit.ts`:
   ```ts
   export const MAX_AUDIT_SIZE = 1024 * 1024;              // 1 MB, unchanged

   export type DenialEntry = {
     kind: "denial";
     ts: string; stage: string; tool: string; input: string; reason: string;  // the five, unchanged
     rule: GuardRuleId;                                                      // NEW
   };
   export type BypassEntry = {
     kind: "bypass";
     ts: string; stage: string; tool: string; tool_use_id: string; version: string;
   };
   export type AuditEntry = DenialEntry | BypassEntry;

   export function auditLogPath(cwd: string): string;       // resolve(cwd, ".vibe-racer", "audit.log")
   export function ensureAuditDir(cwd: string): boolean;
   export function appendAuditEntry(cwd: string, e: AuditEntry): boolean;
   ```
   `GuardRuleId` is imported as a **type** from `./guard.js` — type-only, so no runtime edge and the
   leaf property of `guard.ts` is untouched.
2. `ensureAuditDir(cwd)`: `mkdirSync(dirname, { recursive: true })`, then write
   `.vibe-racer/.gitignore` containing `*` **only if it does not already exist** — existing content
   is never overwritten (F6.1). Returns `false` on any failure; never throws.
3. `appendAuditEntry`: call `ensureAuditDir` (idempotent, so F6.1 holds for projects initialised
   before this release without `init` and the guard each owning a copy of the rule); on
   `statSync(path).size >= MAX_AUDIT_SIZE`, `renameSync(path, path + ".1")` replacing any previous
   `.1`, then append to a fresh file. Return `true` only when the line reached disk, and
   `return false` where the old code had `catch {}`. **Still never throws.**
4. Write `kind` **first** in the serialised object literal so a human running `tail -f` can tell
   entry types apart at a glance (`JSON.stringify` preserves insertion order for string keys).
5. **The red wiring test** (Q5). Rewrite `tests/claude/session.test.ts`'s regression case as a
   single test carrying **both** regression assertions — `options.hooks.PreToolUse` is a non-empty
   array of matchers whose first matcher has a non-empty `hooks` array, **and**
   `"canUseTool" in options === false` — marked `it.fails(...)`. At `M3` it throws on the first
   assertion, so the suite stays green and the file documents what is still broken; `M4` flips it to
   a plain `it(...)` in the same commit as the fix. See §15 D2 for why both assertions share one
   test.

### Test requirements

`tests/claude/audit.test.ts` (rewritten — the mocked `node:fs` approach stays, with `renameSync`,
`existsSync`, `writeFileSync`, `openSync` and `closeSync` added to the mock):

- A denial entry round-trips: `kind` is the first key, the five existing fields are unchanged, and
  `rule` is present.
- A bypass entry round-trips with `kind: "bypass"`, `tool_use_id` and `version`.
- At the cap: `renameSync(audit.log -> audit.log.1)` is called, any previous `.1` is replaced, the
  entry is then appended, and the function returns `true`. **This replaces the deleted "skips write
  when file exceeds 1 MB" case** — no entry is discarded (F6.3).
- Rotation failure returns `false` and does not throw.
- An unwritable directory returns `false` and does not throw.
- `ensureAuditDir` writes `.vibe-racer/.gitignore` containing `*` when absent, and does **not**
  touch it when present.
- `auditLogPath` is the one definition: a test asserts the string the function returns is the path
  `appendAuditEntry` writes to.

`tests/claude/session.test.ts`: the `it.fails` regression test described in task 5.

---

## 6. M4 — The fix: the hook runs

### Goal

**This is the milestone that fixes the bug.** The guard is registered under `hooks.PreToolUse` with
no matcher; `canUseTool` is absent from the options `query` receives; the lap's list narrows context
through the SDK `tools` option; every denial is audited; and the banner prints only downstream of an
assertion that the hook is installed.

### Code reuse

- **Reused**: `decideToolCall` (M1) for every decision; `appendAuditEntry` (M3) for every record;
  `toolsForSession` (M2) for the one list; `formatGuardSummary` (M1) for the banner; `log.warn` and
  `log.guard` for output. No rule is re-implemented and no message is assembled anywhere but
  `formatDenial`.
- **Extended**: `runAndStream` keeps its structure — the skill probe, the `for await` stream loop,
  the partial-message handling and the result line are untouched; the options literal moves out into
  `buildSessionOptions`.
- **New**: `src/claude/guard-hook.ts`, `src/claude/session-options.ts`.

### Tasks

1. `src/claude/guard-hook.ts`:
   ```ts
   import type { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

   export interface GuardRun {
     hook: HookCallback;
     sawToolUse(id: string): boolean;
     readonly tools: readonly string[];
   }

   export function createGuardRun(options: GuardOptions): GuardRun;

   /** The one place the user-visible denial string is assembled. */
   export function formatDenial(d: Extract<GuardDecision, { behavior: "deny" }>): string;
   //   -> `Denied: ${tool} ${input} — ${reason}`   (byte-identical to today)

   export function assertHookInstalled(options: unknown): { ok: true } | { ok: false; what: string };
   ```
   `createGuardRun` is a **factory with closure state** and there is no module-level mutable state
   in any guard module: two sessions run in one process at `cleanup_ready`, and `M6` makes the tally
   user-visible, so a shared `Set` or `Map` would be a correctness bug in a security surface.
2. The hook body, exactly as `02_design.md` §6.3:
   - return `{}` when `input.hook_event_name !== "PreToolUse"` (it is registered with no matcher, so
     it must dispatch on the event itself);
   - read `tool_name`, `tool_input` and `tool_use_id` from the input — **not** the
     `(toolName, input)` positional shape `canUseTool` used — casting `tool_input ?? {}` to
     `Record<string, unknown>` once, at this boundary, because the SDK types it `unknown`;
   - `seen.add(id)` **before** deciding, for denied calls too: a denied call still has a
     `tool_use_id` and the SDK may still emit a `tool_result` for it. Recording only allowed ids
     would make every denial look like a bypass to `M7`'s heartbeat — a self-inflicted false abort;
   - `allow` returns `{}`, **not** `permissionDecision: "allow"`: under `bypassPermissions` the
     session auto-approves anyway, and returning `"allow"` would make the hook an approver rather
     than a vetoer, which is a larger claim than this task ships;
   - on deny: `log.warn(formatDenial(decision))`, then
     `appendAuditEntry(cwd, { kind: "denial", ts, stage, tool, input, reason, rule })` **inside** the
     hook before it returns (a session killed by the heartbeat or by `maxTurns` must still have every
     denial on disk), and `log.error("Audit entry not written — <path>")` when it returns `false`.
     An unwritable audit log still **denies**: the decision was already made, and an unrecordable
     denial is not an allow;
   - return the denial as
     `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: msg } }`
     — a top-level `{ behavior: "deny" }` is the `canUseTool` shape and is silently ignored on the
     hook path;
   - **the wrapper itself fails closed.** Everything above sits inside one `try`/`catch` in the hook
     body, and the `catch` returns the same deny shape with reason `Internal guard error: <msg>`
     (the `internal-error` rule id, audited like any other denial, best-effort). `decideToolCall`
     already catches its own throws, but the wrapper does more than decide — it reads the input,
     logs, and appends to the audit log — and the SDK does not document whether a hook that throws
     or times out (`HookCallbackMatcher.timeout`) counts as allow or deny. A guard must not depend on
     the answer. Tier 2 pins it: a hook whose `appendAuditEntry` is mocked to throw still returns
     `permissionDecision: "deny"`.
3. `assertHookInstalled(options)` asserts three things and names the first failure: `hooks.PreToolUse`
   is a non-empty array; its first matcher's `hooks` array is non-empty; `"canUseTool" in options`
   is `false`. It lives here, not in `session.ts`, so `M5`'s pre-flight need not import the session
   runner (§20.1 of the design).
4. `src/claude/session-options.ts` — `buildSessionOptions(input)` returning
   `{ prompt, options, run }`, **pure and synchronous** (skill resolution already happened in
   `runAndStream`, which is what lets pre-flight call this with a representative input and get a
   real options object without starting anything). It builds exactly `02_design.md` §8.2: `cwd`,
   `systemPrompt`, `settingSources: ["project", "user"]`, **`tools`** (no `allowedTools`),
   `maxTurns`, `includePartialMessages: true`, `permissionMode: "bypassPermissions"`,
   `allowDangerouslySkipPermissions: true`, `abortController`, and
   `hooks: { PreToolUse: [{ hooks: [run.hook] }] }` — **no `matcher` key**, which is what makes F1.1
   true — and **no `canUseTool`**. `run` is `null` only when no `stage` is given. The array in
   `options.tools` is the **same object** as `run.tools` (`Object.is`), not a copy.
5. `src/claude/session.ts`:
   - build one `GuardRun` per session from
     `createGuardRun({ cwd, stage, taskPlanPath, plansDir, tools, jailToPlanDir })`;
   - create an `AbortController` and pass it through `buildSessionOptions` (`M7` is what calls
     `abort()`; the option is part of the shape now);
   - call `assertHookInstalled(built.options)` on the **real** options object on the line before
     `query(...)`, throwing with its `what` if it fails — still before anything is spent on that
     session;
   - print `log.guard(formatGuardSummary(stage, run.tools, jailToPlanDir))` **after** that assertion
     passes. The print being downstream of the assertion is the whole of F7.1 in one line of control
     flow. The banner now sits after skill resolution, so its list includes `Skill` exactly when the
     lap resolved one — which is F7.2;
   - delete the SDK `allowedTools` option (§5.4): under `bypassPermissions` it has no effect on what
     the model may call, and a second list that must agree with the first is a drift surface with no
     benefit;
   - give the skill-discovery probe session (`session.ts:60`) `tools: []` (E15), so "every session
     vibe-racer starts either is guarded or can call no tool at all" is a sentence with no
     exceptions.
6. Flip `tests/claude/session.test.ts`'s `it.fails(...)` from `M3` to `it(...)`. This milestone's
   diff therefore contains both the fix and the removal of the inversion — one commit in which the
   discriminating power of the assertion is visible.

### Test requirements

`tests/claude/guard-hook.test.ts` (new) and `tests/claude/session.test.ts` (rewritten):

- `options.hooks.PreToolUse` is a non-empty array of matchers with a non-empty `hooks` array, and
  the matcher has **no `matcher` key**.
- `"canUseTool" in options === false` — the one assertion that makes the original defect impossible
  to reintroduce silently. **The wiring test fails if the guard is passed only as `canUseTool`.**
- The captured hook, invoked with a real `PreToolUseHookInput` literal, returns
  `hookSpecificOutput.permissionDecision === "deny"` with a `permissionDecisionReason` equal to
  `formatDenial`'s output.
- A tool **outside** the lap's list is denied by that same captured hook (F2.1 is not
  narrowing-only).
- `Object.is(options.tools, run.tools)` — identity, not deep equality, because deep equality passes
  for two independently computed lists that happen to agree today.
- A denial driven through the hook with a `mkdtempSync` cwd appears as a JSON line in
  `<cwd>/.vibe-racer/audit.log` (issue #7's own suggestion), and `<cwd>/.vibe-racer/.gitignore`
  contains `*`.
- An allowed call returns `{}` and writes nothing.
- `sawToolUse` is true for the id of a **denied** call — the false-abort trap `M7` depends on.
- `jailToPlanDir: true` at `cleanup_ready` denies a `Write` outside the plan folder and allows one
  inside it, restoring through the hook the coverage the two deleted `canUseTool` cases had.
- The skill-discovery probe session is called with `tools: []`.
- An input whose `hook_event_name` is not `"PreToolUse"` returns `{}` without deciding.

`tests/live/` (opt-in, run at `G2`): `L1` the hook fires and the denied `Write` does not happen;
`L2` `tools`-only with no `allowedTools` still routes search through `Grep`/`Glob`; `L3`
`settingSources: ["project", "user"]` with `permissions.allow: ["Bash"]` at a review stage is still
denied (E5); `L4` `strictMcpConfig: true` with connectors installed (E6 — context only; the hook
denies them either way); `L6` a session with `canUseTool` reintroduced makes the warning canary
fire; `L9` a project `.claude/settings.json` with `disableAllHooks: true` — whether the SDK-supplied
`PreToolUse` hook still fires under `settingSources: ["project", "user"]`.

---

## 7. M5 — Pre-flight refusal and the SDK pin

### Goal

A lap that cannot be guaranteed enforcement **does not start**, and the SDK the probes ran against
is the SDK that gets installed.

### Code reuse

- **Extended**: `src/git/operations.ts` gains `isPathTracked` beside the other `SimpleGit` helpers;
  `src/pipeline/states.ts` gains `LAP_LABEL` beside `STAGE_NEXT_NAME`, the map it is a sibling of
  (§15 D4).
- **Reused**: `ensureAuditDir` and `auditLogPath` (M3) for checks 3 and 4, so a refusal cannot end
  up checking a different file from the one the guard writes; `buildSessionOptions` and
  `assertHookInstalled` (M4) for check 2; `log.error` / `log.dim` for the renderer; `createRequire`
  from `node:module` — a new use of a built-in, not a dependency.
- **New**: `src/claude/guard-preflight.ts`.

### Tasks

1. `src/claude/guard-preflight.ts`:
   ```ts
   export const VERIFIED_SDK_VERSION = "0.3.270";

   export type PreflightResult =
     | { ok: true }
     | { ok: false; what: string; fix: string | null };   // fix === null => our defect, report it

   export function preflight(cwd: string): Promise<PreflightResult>;
   ```
   Returning the **first** failure as a single value — not an array — makes "report only the first"
   structural rather than a caller's discipline. `fix: null` is the typed way to say "there is no
   command you can run", so the renderer needs no special case for a missing fix line.
2. The four checks, reported in the order **1, 2, 3, 4**:
   1. **SDK version.** `createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk")`,
      read `package.json` **from that file's directory**, string-equal against
      `VERIFIED_SDK_VERSION`. Not the `./package.json` subpath — the package's `exports` map does
      not expose it and resolving it throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, which would turn every
      `drive` into a refusal. Not vibe-racer's own `dependencies`, which would echo the pin back and
      verify nothing. A failure to resolve or parse is itself a **refusal**, never a pass: fail-closed
      is the only direction available to a check whose job is to prove enforcement exists.
      `what`: `the tool guard has not been verified against the installed SDK (found <x>, verified <y>)`.
      `fix`: reinstall vibe-racer, or remove the `overrides` entry for `@anthropic-ai/claude-agent-sdk`.
      **The fix must never read "install the SDK"** — vibe-racer is a globally installed CLI and the
      SDK lives inside its own install, so installing it in the user's project would add a package to
      *their* repository and change nothing.
   2. **Hook registered.** `assertHookInstalled(buildSessionOptions(<representative input>).options)`;
      `fix: null`.
   3. **Audit log untracked.** `isPathTracked(git, ".vibe-racer/audit.log")` — `git ls-files
      --error-unmatch`, whose exit status is the answer, with no parsing. Not a git repository means
      skip silently. `fix`: `git rm --cached .vibe-racer/audit.log`.
   4. **Writable.** `ensureAuditDir(cwd)`, then `openSync(auditLogPath(cwd), "a")` and `closeSync`.
      It does **not** write an entry, so a lap with no denials leaves the log untouched (F3.4).
      `fix` names the path it could not write.

   `preflight` is `async` only because check 3 asks git. **3 before 4** so a log that is both tracked
   and unwritable reports `git rm --cached` first: the prerequisite fix (§15 D1).
3. The refusal renderer — one function, in `guard-preflight.ts`, shared by both call sites:
   ```
   Refusing to start <subject>: <what>.
   No session was started and nothing was spent.
   -> <fix>                                        (omitted when fix === null)
   If you want an unguarded agent in this repository, run `claude` directly.
   ```
   `drive` passes `subject = "the <lap-label> lap"`; `fasten` passes `"the fasten analysis"`. The
   last line is the acknowledgement of the legitimate need. The three-part contract is assembled
   **here and only here**, so every trigger inherits it — including triggers a later task adds.
4. `src/pipeline/states.ts`: add `LAP_LABEL: Partial<Record<Stage, string>>` for the seven agent
   stages (`ai_objective_review: "objective-review"`, `ai_product_review: "product-review"`,
   `ai_design_review: "design-review"`, `ai_plan_review: "plan-review"`,
   `ready_to_execute: "execution"`, `ai_qa: "QA"`, `cleanup_ready: "cleanup"`), so the refusal reads
   as the objective's reference wording: *"Refusing to start the product-review lap: ..."*.
5. `src/cli/drive.ts`: call `preflight(cwd)` **after** `selectTask` returns a task and **before**
   `checkoutBranch` (`drive.ts:197`). On `!ok`: render, then `process.exit(1)` — no branch, no
   commit, no state write. Earlier placement is wrong three ways: it would refuse a `drive` that has
   no lap to run, block `finalizeTask`'s commit of a finished task (`drive.ts:33`, the other
   `checkoutBranch`, which starts no session) over an SDK mismatch that task no longer cares about,
   and be unable to name the lap.
6. `src/cli/fasten.ts`: call `preflight(cwd)` after the active-plan check and before
   `runFastenAnalysis(cwd)`, with the same renderer and the same non-zero exit. `fasten` starts a
   guarded session, and "a session that cannot be guarded does not start" must not have a second
   entry point that skips the four checks.
7. `package.json`: pin the SDK exactly.
   ```diff
   -    "@anthropic-ai/claude-agent-sdk": "^0.3.270",
   +    "@anthropic-ai/claude-agent-sdk": "0.3.270",
   ```
   Run `npm install --save-exact @anthropic-ai/claude-agent-sdk@0.3.270` so `package-lock.json` is
   regenerated **in the same commit**. The pin is stronger than it looks: the SDK pins its
   per-platform binary packages to the same exact version, so this also fixes the executable that
   honours the hook. No `semver` dependency — equality on an exact pin is a string compare.

### Test requirements

`tests/claude/preflight.test.ts` (new, tier 2):

- Each of the four triggers refuses, with the right `what` and `fix`.
- **First failure only**: with checks 1 and 3 both failing, the result names the SDK.
- **3 before 4**: with the log both tracked and unwritable, the result names `git rm --cached`.
- Check 2 returns `fix: null`.
- A directory that is not a git repository passes check 3 silently.
- An unresolvable or unparseable SDK `package.json` **refuses** (fail-closed), not passes.
- **Negative**: no refusal message contains the string `npm install @anthropic-ai/claude-agent-sdk`
  — a sentence someone will helpfully add back.
- The drift test: `package.json`'s `dependencies["@anthropic-ai/claude-agent-sdk"]` equals
  `VERIFIED_SDK_VERSION` exactly, with no caret, tilde or range.
- `LAP_LABEL` has an entry for every agent stage, and the rendered refusal for `ai_product_review`
  matches the objective's reference wording.

`tests/cli/drive.test.ts` and `tests/cli/fasten.test.ts` (extended):

- A failing pre-flight exits non-zero, and `checkoutBranch`, `commitAll`, `updateStage` and
  `runAndStream` are **never called**; `state.yml` is byte-identical afterwards (F3.3, F3.5).
- A passing pre-flight leaves today's behaviour unchanged.
- `drive` with no actionable task never calls `preflight`.
- **Negative**: the `drive` command registers no `--unguarded`-like flag — assert over
  `createProgram()`'s registered options that none matches `/unguard|no-?guard|unsafe/i`, and that
  no file under `src/` reads an env var matching `/UNGUARD|SKIP_GUARD/`.

---

## 8. M6 — Denial surfaces and honest banners

### Goal

A reader can tell what the guard did without opening a file, an agent that retries a blocked call
eight times costs one screenful, and no surface in the CLI names a mechanism that no longer exists.

### Code reuse

- **Extended**: the `GuardRun` from `M4` gains the suppression set, the counts map and `summary()`;
  the hook body gains two lines; `runAndStream` gains a `finally`.
- **Reused**: `auditLogPath` for the summary's path; `log.dim` for `radio`'s notice; `log.guard` for
  `init`'s line.

### Tasks

1. `src/claude/guard-hook.ts` — add to the closure: `printed: Set<string>` and
   `counts: Map<string, { tool, rule, reason, count }>`, keyed by
   `[tool, rule, reason].join("\u0000")`. **`U+0000`, not `|`**: `reason` can contain any character
   (a path, a command, an error message), and a separator that can appear inside a field is a
   collision waiting to be found by exactly the adversarial input this module exists to handle.
   The hook body gains `if (!printed.has(key)) { printed.add(key); log.warn(msg); }` and
   `bump(counts, key, decision)`, so **every** denial is counted and audited while only the first of
   a pair prints (F4.4).
2. Add to the `GuardRun` surface:
   ```ts
   export interface DenialSummary {
     total: number;                                       // every denial, incl. suppressed ones
     groups: { tool: string; rule: GuardRuleId; reason: string; count: number }[];
     logPath: string;
   }
   summary(): DenialSummary | null;                        // null when there were no denials
   ```
   `summary()` is **pure and idempotent** — it reads `counts` and returns a fresh object, mutating
   nothing — so the `finally` that prints it can run on both the success and the error path without
   double-counting, and `runAndStream` need not remember whether it already printed. `groups` is
   sorted by `count` descending, then `tool`, then `rule`: this block gets pasted into issues, and a
   stable order makes two pastes comparable. Returning `null` at zero puts F4.1 in the data model
   rather than in an `if` at each call site.
3. `src/claude/session.ts`: print the summary in a `finally` around the stream loop — the count, the
   distinct groups with their counts, and the **path** (`logPath`), **never the entries**: this
   output gets pasted into issues and an entry can hold something sensitive the agent tried to run
   (F4.2). Nothing is printed when `summary()` returns `null`. Because every session goes through
   `runAndStream`, this one `finally` covers every call site, including both `cleanup_ready`
   sessions.
4. `src/cli/radio.ts`: one `log.dim` line immediately before `spawnClaude` — this is the user's own
   `claude` CLI, the tool guard does not apply, nothing here is restricted. **No prompt, no
   confirmation**: `radio` is explicitly interactive and attended, and a user sitting at a prompt
   they asked for should not be asked to confirm it.
5. `src/cli/init.ts:82`: replace `Security: canUseTool path-jail enabled (project root only)` with
   `Security: tool guard enforced on every drive session (PreToolUse hook)`.

### Test requirements

`tests/claude/guard-hook.test.ts` (extended, tier 1):

- Suppression is on `(tool, rule, reason)`: eight identical denied `Bash` calls print **once**,
  audit **eight** times, and report `total: 8` in one group.
- Two denials differing only in `reason` — the `References sensitive path: <path>` case of
  `02_design.md` §4.4 — print twice and form two groups. That is correct behaviour, and the one
  place F4's collapsing collapses less than a reader might expect.
- `summary()` returns `null` at zero denials, is idempotent across two calls, and is sorted
  deterministically.
- **Two `GuardRun`s in one process do not share state**: denials on the first do not appear in the
  second's summary (the `cleanup_ready` pair).

`tests/claude/session.test.ts` (extended, tier 2):

- The summary block is printed when the session **throws**, not only when it completes (F4.3).
- A session with zero denials prints nothing at all.
- The printed block contains `auditLogPath(cwd)` and **none** of the audited `input` or `reason`
  strings.

`tests/cli/radio.test.ts` (extended) and `tests/cli/init.test.ts` (new):

- `radio` prints the notice before `spawnClaude` is called, and prompts for nothing.
- `init`'s banner does not contain `canUseTool` and names `PreToolUse`.
- **Structural negative**: the only file under `src/` containing the literal `canUseTool` is
  `src/claude/guard-hook.ts`, where `assertHookInstalled` asserts its absence. Fails if anyone
  reintroduces it in a banner, a doc string or the options builder.

---

## 9. M7 — Heartbeat, detect-only

### Goal

A `tool_result` whose call the hook never saw is **detected on the result that reveals it** and
recorded as its own audit entry, with a warning. Whether it also aborts is `G2`'s to decide.

### Code reuse

- **Reused**: the `for await` loop `runAndStream` already has — this is read-only inspection of
  messages it already iterates, so no extra SDK surface and no polling; the `AbortController`
  already threaded through `buildSessionOptions` in `M4`; `appendAuditEntry` for the bypass entry.
- **Extended**: `GuardRun` gains `recordBypass`; `src/cli/index.ts`'s `package.json` version import
  moves into `src/version.ts` and both consumers import it from there.
- **New**: `src/version.ts` (three lines), the `toolResultBlocks` reader, `HEARTBEAT_ABORTS`.

### Tasks

1. `src/version.ts`:
   `import pkg from "../package.json" with { type: "json" }; export const VERSION: string = pkg.version;`
   and change `src/cli/index.ts:9` to import `VERSION` from it. One definition, two consumers.
2. `src/claude/guard-hook.ts`: add `recordBypass(toolName: string, toolUseId: string): void` —
   appends `{ kind: "bypass", ts, stage, tool, tool_use_id, version: VERSION }` and logs one
   `log.error` line naming the tool and the id. It belongs in the same file as the hook because it
   is the same session's record.
3. `src/claude/session.ts` — the detect path:
   - `export const HEARTBEAT_ABORTS = false;` with a comment naming `G2`/`L5` as what flips it;
   - a `toolResultBlocks(message)` helper: for `message.type === "user"`, guard
     `typeof message.message.content !== "string"`, filter `block.type === "tool_result"`, and read
     `block.tool_use_id`. `parent_tool_use_id` and `isSynthetic` are read and included in the
     warning line, because they are the levers `M8` may need;
   - in the stream loop, for each such block whose id `run.sawToolUse(id)` does not know:
     `run.recordBypass(name, id)` and one warning line. When `HEARTBEAT_ABORTS` is `true` (M8),
     additionally set the `aborting` flag, call `abortController.abort()` and break out of the loop;
     while it is `false`, the session continues;
   - the `aborting` boolean local is introduced now and set immediately **before** `abort()`, so an
     abort we initiated is distinguishable from a user `SIGINT` in the `catch`. Without it, a
     `Ctrl-C` during a healthy session would surface as a guard bypass, error the task and block its
     retry — the most expensive possible false positive.
4. `tests/live/false-abort.live.test.ts` — **probe `L5`, the blocking prerequisite** (F5,
   `02_design.md` §10.5). Three cases, each recording whether a `tool_result` arrives whose
   `PreToolUse` the hook never saw, and which lever (if any) excludes it: (a) a call to a tool
   removed from context by the `tools` narrowing; (b) a subagent's calls — `Task` is denied at every
   stage, so this should be unreachable, and "should be unreachable" is what this whole task is
   about; (c) a `server_tool_use`. The test **records**; it does not assert a verdict, because the
   verdict is what `G2` produces.

### Test requirements

`tests/claude/heartbeat.test.ts` (new, tier 2 — a synthetic stream, no SDK):

- A `tool_result` whose id the run **never saw** produces exactly one bypass audit entry with
  `kind: "bypass"`, the tool name, the id and `VERSION`; with `HEARTBEAT_ABORTS === false` the
  session **continues** and returns its result.
- A `tool_result` whose id the hook **did** see produces nothing.
- A `tool_result` for a **denied** call produces nothing — the hook recorded its id before deciding.
  This is the inverse of the self-inflicted false abort.
- `message.message.content` as a plain string, and a `user` message with no `tool_result` block, are
  both handled without throwing.
- Two unseen ids in one session produce two entries and no crash.
- With `HEARTBEAT_ABORTS` forced `true` in the test, `abortController.abort()` is called on the
  **first** unseen result and the loop stops — the `M8` branch's contract, asserted before `M8`
  ships it.

---

## G2 — Run the live probe suite

**Why this is an operator row.** `npm run test:live` opens real, paid sessions. F10's reason for the
dry-run gate — *the spend is the operator's* — applies unchanged to a suite that opens real
sessions; reaching it through `vitest` rather than through `drive` does not change who pays (Q3).

**`L5` is the blocking prerequisite:** `M8` cannot choose its branch without it.

- [ ] From the task checkout, run `npm run build && npm run test:live` and keep the output
- [ ] Create `plans/0007_guard-actually-runs/04_live_probes.md` with one table row per probe, in the shape `| L1 | <what it settled> | pass / fail / not run | <notes> |`
- [ ] `L1` — the hook fires under `bypassPermissions` and the denied `Write` does not happen
- [ ] `L2` — `tools`-only with no `allowedTools`: a search still routes through `Grep` and `Glob`
- [ ] `L3` — `permissions.allow: ["Bash"]` in project settings does **not** get `Bash` past the hook at a review stage
- [ ] `L4` — whether `strictMcpConfig: true` keeps MCP tools out of *context*; the hook denies them either way
- [ ] `L5` — **the three false-abort cases.** For each of (a) a tool removed from context, (b) a subagent call, (c) a `server_tool_use`, record whether a `tool_result` arrived whose `PreToolUse` the hook never saw, and whether `parent_tool_use_id`, `agent_id` or `isSynthetic` distinguishes it. State one of three verdicts in the file: **clean**, **excluded by lever `<name>`**, or **unexcludable**
- [ ] `L6` — the `CLAUDE_SDK_*` warning canary fires when `canUseTool` is deliberately reintroduced
- [ ] `L7` — **the `fasten` manual check**: in a scratch repository, run `node <task checkout>/dist/index.js fasten`, and confirm three things: the `Guard:` banner is printed and lists exactly `Read, Glob, Grep`; `.vibe-racer/.gitignore` exists (pre-flight ran before the session); and the run left no file changed outside `.vibe-racer/` (`git status`). A clean run denies nothing, so an empty audit log proves nothing by itself
- [ ] `L8` — every tool name in `TOOLS_BY_STAGE`, `DECISION_TOOLS` and `FASTEN_TOOLS` appears in the session's own tool list
- [ ] `L9` — **`disableAllHooks`.** A scratch project whose `.claude/settings.json` sets `"disableAllHooks": true`, under `settingSources: ["project", "user"]`: does the SDK-supplied `PreToolUse` hook still fire, and is the out-of-list `Write` still denied? The SDK's settings schema documents the key as "Disable all hooks", and its hooks-listing types distinguish "session hooks" from settings-file hooks without saying which the key silences. Record one of: **hook fires regardless** (nothing to do), or **hook silenced** — then `M8` also makes pre-flight check 2 read the loaded settings files (`.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json`) and refuse with `fix: remove "disableAllHooks" from <file>` when any sets it, the same way a tracked audit log refuses. The guard must not depend on a key the host project controls
- [ ] If the suite cannot run at all (no budget, no credentials), say so in the file against every probe. **Do not tick this as "skipped"** — `M8` then takes the warning-only branch and `05_qa.md` records that the abort was never probed

**Verification:** `test -f plans/0007_guard-actually-runs/04_live_probes.md && grep -cE '^\| *L[1-9] *\|' plans/0007_guard-actually-runs/04_live_probes.md && grep -iE 'clean|lever|unexcludable|not run' plans/0007_guard-actually-runs/04_live_probes.md`

---

## 10. M8 — Fork resolution: the bypass contract

### Goal

Turn `G2`'s recorded verdict into shipped behaviour. **One of three branches**, selected by reading
`04_live_probes.md` — not by judgement at execution time.

| `L5` verdict in `04_live_probes.md` | Branch | What ships |
|---|---|---|
| **clean** — no false abort on any of the three cases | **A** | `HEARTBEAT_ABORTS = true` plus the full bypass contract (tasks 1–8) |
| **excluded by lever `<name>`** | **B** | Branch A, plus the lever as a one-line filter in the detect loop, plus the excluded case named for `M10` to put in `docs/security.md` |
| **unexcludable**, or `L5` **not run** | **C** | **Warning-only is the shipped behaviour.** `HEARTBEAT_ABORTS` stays `false`; tasks 2–8 are **not written**; tasks 1 and 9 only |

The third column is why the fork is cheap: `M7` already ships the detect path, the bypass audit
entry and the warning, so the "bad" outcome is a milestone that writes documentation rather than one
that removes code. **The guard itself shipped in `M4` regardless** — no branch here can delay what
acceptance depends on.

### Code reuse

- **Extended, not duplicated**: `setError` gains an **optional fourth parameter** rather than a
  second function, so its salvage path — the one that must never throw — keeps a single
  implementation; `updateStage` learns to clear the two new fields; `commitAll`'s `scanFiles`
  pre-commit scan is reused verbatim by `commitPaths`; `drive.ts`'s existing `error` branch
  (`drive.ts:214`) is where the gate goes, evaluated before `updateStage`.
- **Reused**: `GuardRun.recordBypass` and the detect loop from `M7`; `SecretDetectedError`;
  `VERSION` from `src/version.ts`.
- **New (branches A and B only)**: `GuardBypassError`, `commitPaths`, `isTreeClean`, two `state.yml`
  fields, the retry gate.

### Tasks

1. **Read `plans/0007_guard-actually-runs/04_live_probes.md` first** and record the chosen branch
   and the `L5` verdict verbatim in the milestone's Notes cell. Record the `L9` verdict too: on
   **hook silenced**, add the settings-file read to pre-flight check 2 in `guard-preflight.ts`
   (refusal and `fix` as `G2`'s `L9` line states), with a tier-2 case per settings file, regardless
   of which `L5` branch is taken. For branch B, implement the lever as
   a single filter in the detect loop (`parent_tool_use_id !== null`, `agent_id`, or `isSynthetic`),
   with a comment naming the probe that motivated it.
2. `src/claude/guard-hook.ts`: `export class GuardBypassError extends Error` carrying `toolName`,
   `toolUseId` and `version`, with a message that distinguishes a guard bypass from an ordinary
   session failure and says the lap was stopped mid-flight. **A class, not a message convention**:
   `qa.ts` and `execute.ts` have their own `catch` blocks that rethrow what they do not recognise,
   and only an `instanceof` check survives that path. See §15 D5 for why it lives here.
3. `src/claude/session.ts`: set `HEARTBEAT_ABORTS = true`; on the first unseen `tool_result`, set
   `aborting = true`, call `run.recordBypass(...)` and `abortController.abort()`, break the loop and
   throw `GuardBypassError`. **Not `query.interrupt()`**, which is a graceful turn-boundary stop —
   the point is to not let the session take another step. In the `catch`, an abort with
   `aborting === false` is a user `SIGINT` and is rethrown untouched.
4. `src/state/schema.ts`: add beside `error_stage` and `error_message`
   ```ts
   guard_bypass: z.boolean().optional(),
   guard_bypass_version: z.string().optional(),
   ```
   Separate fields, not folded into `error_message`, following the precedent the operator-pause
   fields already set: a gate that greps an error message is an invariant held by string inspection,
   which is the defect class this repository has already paid for once.
5. `src/state/store.ts`:
   - `setError(planPath, errorStage, message, extra?: { guard_bypass?: boolean; guard_bypass_version?: string })`
     — the extra fields go into the **salvage** write and the last-resort hand-written record too: an
     abort on a task with a corrupt `state.yml` must still record that it was a bypass, because the
     gate is the only thing standing between the user and a second paid bypass;
   - `updateStage` **explicitly drops** `guard_bypass` and `guard_bypass_version` whenever the new
     stage is not `error`. Today it spreads the whole state forward, so "a successful retry clears
     the marker" is not something it does yet (Q1).
6. `src/git/operations.ts`:
   - `commitPaths(git, paths: string[], message: string, cwd?: string): Promise<string>` — a
     **partial commit** (`git commit -m <msg> -- <paths>`), which commits those paths' working-tree
     content and ignores the index entirely, so nothing the session wrote can be swept in even if
     something was staged. It runs the same `scanFiles` scan over its own path set, for parity with
     `commitAll`; a `SecretDetectedError` is reported, never buried;
   - `isTreeClean(git): Promise<boolean>` — `(await git.status()).isClean()`.
7. `src/pipeline/handlers/safe-wrapper.ts`: a `GuardBypassError` branch —
   **skip `commitAll`** (the unguarded call's output must not be committed, F5.2); **roll back
   nothing** (the partial work stays in the working tree, uncommitted and visible in `git status`,
   because silently reverting would destroy the only evidence of the bypass, F5.3);
   `setError(ctx.planPath, stage, message, { guard_bypass: true, guard_bypass_version: VERSION })`;
   then `commitPaths(git, ["<plan>/state.yml"], "vibe-racer: guard bypass recorded for #N", ctx.cwd)`;
   then rethrow. If that commit fails, say so and name the file — the marker is still on disk and the
   gate holds for as long as it is.
   **Why `state.yml` is committed alone:** without it the marker exists only as an uncommitted change
   in the very tree the retry gate asks the user to clean, so a `git stash -u` or `git reset --hard`
   would erase it, the task would fall back to its previous stage, and the next `drive` would run the
   lap again on the same version — the gate defeated by following its own instruction.
8. `src/cli/drive.ts`, in the `error` branch **before** `updateStage` (`drive.ts:214`): when
   `state.guard_bypass === true`, refuse unless **both** hold — the installed `VERSION` differs from
   `guard_bypass_version`, and `isTreeClean(git)`. **Report both conditions together**, unlike
   pre-flight's first-failure-only: they are two halves of one instruction to the user, not a
   prioritised list of independent faults. The message names the audit log and the dirty working tree
   as the two artefacts to attach to a report, says the block is deliberate, and says that an
   `npm link`ed checkout only passes the version condition after a version bump. When both hold,
   `updateStage(target)` clears the marker and dispatch proceeds as usual. Every other `error` is
   unchanged (E13). **If no fixed version exists yet, the task waits** — that is the real cost of
   this design, stated rather than softened (E11).
9. Record the outcome where the QA lap will read it: append a section to
   `plans/0007_guard-actually-runs/04_live_probes.md` stating the branch taken, the `L5` verdict and,
   for branch C, **why warning-only is what shipped** — plus one line for `M10` to carry into
   `docs/security.md` and the follow-up task to open ("the heartbeat aborts on a bypass"). An
   unprobed abort is not shipped on its author's word.

### Test requirements

Branches A and B — `tests/claude/heartbeat.test.ts` (extended),
`tests/pipeline/safe-wrapper.test.ts` (extended), `tests/cli/drive-retry.test.ts` (new),
`tests/state/store.test.ts` (extended):

- A synthetic stream whose `tool_result` id the run never saw throws `GuardBypassError`; one whose
  id it saw does not; a denied call's result does not.
- `abort()` is called on the **first** unseen result, and an abort error raised with
  `aborting === false` (a `SIGINT`) is rethrown as itself, not as a bypass.
- `withErrorHandling` on a `GuardBypassError` calls `setError` with both bypass fields and
  **does not** call `commitAll`; it calls `commitPaths` with exactly `["<plan>/state.yml"]`; it
  rethrows. On an ordinary error the existing behaviour is untouched.
- `commitPaths` runs the secret scan over its own paths and throws `SecretDetectedError` on a hit.
- `setError`'s extra fields survive the salvage path (unparseable `state.yml`) and the last-resort
  write.
- `updateStage` to a non-`error` stage removes both fields; to `error` it does not.
- The retry gate: refuses on same-version, refuses on dirty tree, **names which condition is
  missing** in each case and both when both are, clears the marker on success, and leaves every
  non-bypass `error` retry exactly as it is today.

Branch C: the `HEARTBEAT_ABORTS === false` tests from `M7` stand as the shipped contract, plus one
test asserting `HEARTBEAT_ABORTS` is `false` and that an unseen `tool_result` does **not** abort — so
a later edit cannot quietly flip a behaviour the probe never cleared.

---

## G3 — The dry run

**Why this is an operator row.** Seven real, paid sessions against a throwaway task. An execute
session cannot start them — it has no business spawning `drive`, and the spend is the operator's
(F10). This is also the **first real use of the guard** (Q4): the dogfood run happens here, in a
scratch repository, with the operator watching and the audit log read afterwards.

**Driven by the opposite binary from `G1`:** this branch's build.

- [ ] Rebuild the task checkout first so `dist/` is this branch's head: `npm run build`
- [ ] Create a scratch repository outside this one (`git init`, one commit, a README.md and a CLAUDE.md), and run `node <task checkout>/dist/index.js init` in it
- [ ] Create a throwaway task and race it through **all seven laps** with `node <task checkout>/dist/index.js drive`, ticking each pit stop as it comes
- [ ] Record **one line per lap**: it completed its own document, or it could not complete and why
- [ ] Copy the scratch repository's `.vibe-racer/audit.log` to `plans/0007_guard-actually-runs/dry-run-audit.log`. **Redact first** if any denied command or path in it contains a real credential — `commitAll` runs the secret scanner over everything staged, and a key-shaped string in the evidence file would block `M9`'s commit (H7)
- [ ] Write `plans/0007_guard-actually-runs/04_dry_run.md` with a `## Laps` table — one row per lap, `| Lap | Completed? | Notes |` — and the denial count the log holds
- [ ] Note anything that stalled, paused or looked wrong even if the lap completed. **A lap that cannot complete is a blocker, not a note**

**Verification:** `test -f plans/0007_guard-actually-runs/04_dry_run.md && test -f plans/0007_guard-actually-runs/dry-run-audit.log && grep -c '^|' plans/0007_guard-actually-runs/04_dry_run.md`

---

## 11. M9 — Classify and fix

### Goal

Every denial the dry run produced is in exactly one of F10's three outcomes, and the fixes that
follow from them are made — **prompt fixes preferred, narrowing only inside the bright line**.

### Code reuse

Prompt fixes are edits to `src/claude/prompts.ts`'s existing bodies — no new prompt and no new
section mechanism. A list change is one line in `TOOLS_BY_STAGE`; a narrowing is a condition in
`guard.ts`. Nothing new is built in this milestone.

### Tasks

1. Read `04_dry_run.md` and `dry-run-audit.log`. Group the entries by `(tool, rule, reason)` — the
   same key `summary()` uses — so a retried call is one finding, not eight.
2. Classify **every** group into one of the three outcomes, in `04_dry_run.md` under a
   `## Classification` table (`| Denial | Lap | Outcome | Fix |`):
   - **correct-and-prompt-fixed** — the rule is right; the agent should not have tried. Prompt or
     skill change, rule untouched. **The preferred outcome — prefer it whenever both would work.**
   - **correct-and-gate-row** — the rule is right and the step genuinely must happen; it becomes an
     `Owner = operator` gate row at plan time in some future plan. Nothing changes here; it uses
     machinery that already exists.
   - **wrong-and-rule-narrowed** — the lap cannot do its documented job at all. Minimal narrowing,
     recorded with the denial, the lap, and **why the other two outcomes did not apply**.
3. Apply the prompt fixes in `src/claude/prompts.ts`. Each one is referenced from the classification
   table by the denial that motivated it.
4. Apply any list change in `src/claude/tools.ts` — adding a tool **only** where its parent tool is
   already allowed (E8), or removing a `TaskOutput`/`TaskStop` seed that `G3` showed is unused, with
   the one-line comment updated to say what the dry run found.
5. Apply any narrowing in `src/claude/guard.ts`, inside F10's bright line: **only** where the rule
   blocks a lap from completing its own documented job. It may **not** broaden what any lap can reach
   beyond that job, and it may **not** remove a rule. A denial needing more than that stops being
   this task's business: it is recorded as a finding for `05_qa.md` and its own follow-up, and this
   task ships with the tight rule. **A surprising dry run delays a rule fix, never the disclosure.**
6. Update the byte-identity table from `M1` for any message a narrowing changed, with the denial that
   motivated the change named in the test file. F1.3 is "messages unchanged **except where F10
   recorded a narrowing**" — unrecorded drift still fails.
7. Write the `## Changed by M9` section in `04_dry_run.md` listing exactly which prompts, lists and
   rules changed. This is the list `G4` re-runs, so it must be precise. If **nothing** changed, say
   so in one line: `G4` is then ticked without a run.
8. If the secret scanner flags `dry-run-audit.log` on commit, summarise its contents in
   `04_dry_run.md` and delete the raw copy (H7). Do not weaken the scanner.

### Test requirements

- Every rule or list change lands with the tier-1 test that pins it: a narrowed rule gets a case for
  the input that motivated it **and** a case proving the rule still denies what it denied before.
- Every prompt change lands with its assertion in `tests/claude/prompts.test.ts`, following that
  file's existing per-prompt-section pattern.
- `npm run test` green with coverage up, not sideways: a classification that removes a test case
  must add a strictly larger set.
- If nothing changed, this milestone adds no test and says so in its Notes cell.

---

## G4 — Re-run what changed

**Why this is a gate.** A narrowing that has not been seen to work under the live guard is not
shipped on its author's word (F10). Only the laps `M9` actually changed are re-raced — and if `M9`
changed nothing, this gate is ticked without a run.

- [ ] Read `## Changed by M9` in `plans/0007_guard-actually-runs/04_dry_run.md`
- [ ] If it says nothing changed: append a `## G4 — re-run` section with the line "no prompt, list or rule changed; no re-run needed", and tick
- [ ] Otherwise: rebuild (`npm run build`) and re-race **only** the named laps in the scratch repository, with the same throwaway task or a fresh one
- [ ] Append `## G4 — re-run` to `04_dry_run.md` with one line per re-run lap: whether it completed, and whether the denial that motivated the fix is gone
- [ ] **One round of re-run is planned.** A second failure is not another gate — it is a `needs_operator` pause and a conversation

**Verification:** `grep -q '^## G4' plans/0007_guard-actually-runs/04_dry_run.md`

---

## 12. M10 — Docs, disclosure and housekeeping

### Goal

Every document names the mechanism actually used, the disclosure is on the branch in the exact
agreed wording, and this repository's own `.gitignore` stops lying about a directory name.

### Code reuse

Documentation only, plus two one-line housekeeping fixes. **No path under `src/` changes in this
milestone** — that is this milestone's own acceptance condition. The pipeline's `commitAll` will
still sweep in `04_execute.md` and `state.yml`, which is expected.

### Tasks

1. **The exact dated line**, in `SECURITY.md` and `docs/security.md`, both dated:
   > **0.3.0 did not enforce the tool guard; earlier versions are unverified.**

   Not "never enforced since 0.1.0" — it was not probed. Not "a bug in 0.3.0 only" — that implies
   earlier versions were fine.
2. `docs/security.md` — the largest edit:
   - **Layer 1** (lines 9–23) is now a restriction, not a coarse auto-approve gate: the SDK `tools`
     option narrows context, and the hook's default-deny is what makes an out-of-list tool
     unreachable. Say explicitly that **narrowing is not a security mechanism** and that no test
     asserts security on it.
   - **Layer 2** (lines 24–105): "A `canUseTool` callback intercepts every tool invocation" becomes
     the `PreToolUse` hook, registered with no matcher, running `decideToolCall`. Rules 0–5 keep
     their numbering and their text; add the new `tool-not-in-list` rule and the rule-id table.
   - **What is a guarded session** (line 106): `drive`'s laps **and** `fasten`; `radio` is not; name
     the skill-discovery probe session (E15) with its `tools: []` so it is not mistaken for a gap.
   - **Audit log** (line 199): rotation at 1 MB to `audit.log.1`; the self-written
     `.vibe-racer/.gitignore`; **what the log may contain — denied commands and paths, verbatim** —
     why that is acceptable for a local, ignored file, and why the end-of-lap summary therefore
     prints the path and never the entries (F6.6).
   - **The three honest limits** of `01_product.md` §2, as prose: the heartbeat's bound is one call
     and not zero; context narrowing is not a security mechanism; `radio` and `fasten` are not
     `drive`.
   - The suppression wrinkle (`02_design.md` §4.4): for the two path-reference Bash rules and for
     `internal-error`, the reason embeds a fragment of the input, so three different out-of-project
     paths are three findings rather than one. That is correct, and it is the only place F4's
     collapsing collapses less than a reader expects.
   - The pre-flight's four refusals, with the exact `fix` for each.
   - The outcome `M8` shipped — including, on branch C, that the abort is **not** shipped and why.
   - Lines 113, 166, 214 and 223: every remaining `canUseTool` mention.
3. `SECURITY.md`: "What's protected" (line 17) names the hook, the tool restriction and the
   pre-flight refusal; "Trust boundary" (29) and the `settingSources` paragraph (31) say that a
   re-granted tool is still denied by the hook (E5, settled by `L3`); the `radio` section (33) keeps
   its shape with `canUseTool` replaced; "Known limitations" (37) gains the heartbeat's one-call
   bound.
4. `docs/how-it-works.md`: line 18 (the diagram box), line 63 (the Guard bullet) and lines 251–256
   ("The guard is unchanged" — now it is changed; say what changed, and that the rules did not).
5. `CLAUDE.md`: the **Tool guard** bullet (line 51) becomes the `PreToolUse`-hook statement, naming
   `decideToolCall` in `guard.ts` as the decision core, `guard-hook.ts` as the transport, `tools.ts`
   as the lap's list with default-deny, `guard-preflight.ts` as the refusal, and the exact SDK pin as
   what makes the verified-version check meaningful. Add the five new modules to the
   project-structure block.
6. `README.md`:
   - rewrite the **Security** section's interim admonition — which the operator put on `main`
     outside the pipeline — into the permanent wording: 0.3.0 did not enforce the guard, the fix is
     in this release, and `npm deprecate` points at it;
   - the bullet list gains the hook, the tool restriction and the pre-flight refusal;
   - **keep** the "two things the guard does **not** do" paragraph and update its second half: the
     guard now runs in `drive` sessions, so what remains is `radio` and the push gap, which is #6
     (F8.3).
7. `CHANGELOG.md`, under `[Unreleased]`:
   - a **Security** entry saying plainly that 0.3.0 did not enforce the tool guard, in the dated
     line's wording, with a pointer to issue #7;
   - **Changed**: MCP tools, `Task`, `WebFetch` and `WebSearch` are denied at every stage (a visible
     change, its own line); the SDK is pinned exactly; `allowedTools` is gone in favour of `tools`;
     one line on **mid-pipeline tasks** — no migration, the next lap is simply guarded;
   - **Added**: the pre-flight refusal, the end-of-lap denial summary, audit-log rotation and the
     self-ignoring directory, `radio`'s notice, and the heartbeat (naming whether it aborts or
     warns).
8. This repository's `.gitignore`: `.viberacer/` becomes `.vibe-racer/`, and **delete** the stale
   `.viberacer-secrets` line — `src/git/secrets.ts` reads filename patterns (`.env*`,
   `credentials.json`, `*.pem`, `*.key`) and content patterns, and knows nothing of such a file
   (F6.5). Confirm the deletion against the scanner's source in the commit message.
9. `plans/0007_guard-actually-runs/04_dry_run.md`: the **final per-lap table**, after `G4` — the one
   the QA lap reads to write `05_qa.md`'s classification section. One row per lap: its denials, the
   outcome each was classified into, and whether a re-run confirmed the fix.
10. **Not in this milestone, and `M10` must not pretend otherwise:** merge, version bump, publish and
    `npm deprecate vibe-racer@0.3.0`. Those are the operator's, after `done`. See §17.

### Test requirements

- A documentation test asserting the exact dated line appears in both `SECURITY.md` and
  `docs/security.md`, with neither "since 0.1.0" nor "0.3.0 only" present in either file.
- The structural negative from `M6`, extended to documentation: no file under `docs/`, plus
  `README.md`, `SECURITY.md` and `CLAUDE.md`, contains `canUseTool` except where it describes the
  **historical** defect.
- `npm run build && npm run typecheck && npm run lint && npm run test` green. No test is added for
  prose beyond the two above; `git diff --stat` showing no file under `src/` is this milestone's own
  check.

---

## 13. Dependency graph

```
G1 (operator: worktree of main, built)
 |
 v
M1 guard.ts: decideToolCall, GuardDecision, GuardRuleId
 |        \
 |         \--------------------------+
 v                                    v
M2 tools.ts + live scaffolding   M3 audit.ts union/rotation + RED wiring test
 |                                    |
 +------------------+-----------------+
                    v
            M4  *** THE FIX ***  guard-hook.ts + session-options.ts + session.ts
                    |
        +-----------+-----------+
        v                       v
   M5 preflight + pin      M6 surfaces (suppression, summary, radio, init)
        |                       |
        +-----------+-----------+
                    v
            M7 heartbeat DETECT (HEARTBEAT_ABORTS = false)
                    |
                    v
            G2 (operator: npm run test:live — L1..L9; L5 blocks)
                    |
                    v
            M8 fork resolution (A / B / C)
                    |
                    v
            G3 (operator: seven-lap dry run, this branch's build)
                    |
                    v
            M9 classify + fix
                    |
                    v
            G4 (operator: re-run only what M9 changed)
                    |
                    v
            M10 docs + disclosure + housekeeping
```

**What the compiler enforces, and what it does not.**

| Edge | Enforced by |
|---|---|
| M1 to M2, M1 to M3, M1 to M4 | `tsc`. `GuardRuleId`, `GuardDecision` and `GuardOptions.tools` do not exist before `M1`, and `createToolGuard` does not exist after it |
| M2 to M4 | `tsc`. `buildSessionOptions` requires the `tools` array `toolsForSession` produces |
| M3 to M4 | `tsc`. The hook appends a `kind`-tagged entry and reads the boolean return |
| M4 to M5 | **Not compiler-enforced.** Pre-flight check 2 asserts on a real built options object; written before `M4`, its own test would have to be skipped. The ordering is the plan's, not the type system's |
| M4 to M6, M4 to M7 | `tsc` for the `GuardRun` surface; the stream scan needs `sawToolUse` |
| M7 to G2 to M8 | **Procedural.** `M8` reads `04_live_probes.md`; the gate's verification is what proves the file exists |
| M8 to G3 to M9 to G4 to M10 | **Procedural**, each gate verified by the check on its own section |

**M5 and M6 are independent of each other** and could swap; they are ordered as written because the
refusal is acceptance criterion C and the surfaces are D. Execution runs them sequentially either
way.

---

## 14. Test strategy

### Three tiers, and what each one is for

| Tier | Scope | Command | Lands in |
|---|---|---|---|
| **1 — rules** | `decideToolCall` called directly; `tools.ts`; `audit.ts`; `GuardRun`'s bookkeeping. No SDK, no network, no log output | `npm run test` | M1, M2, M3, M6 |
| **2 — wiring** | `query` mocked: `hooks.PreToolUse` present, `canUseTool` absent, the captured hook denying in the SDK's **real input shape**, list identity, the audit line on disk, the four pre-flight triggers, the heartbeat contract, the retry gate | `npm run test` | M3 (red), M4, M5, M6, M7, M8 |
| **3 — live** | Real paid sessions in a scratch directory. Never in `npm run test`, never required by CI, skipped without `VIBE_RACER_LIVE=1` | `npm run test:live` | M2 (`L8`), M4 (`L1`–`L4`, `L6`, `L9`), M7 (`L5`); **run at G2** |

The **dry run** (`G3`) is not a test tier. Its output is an audit log and one line per lap, which
`M9` classifies and `M10` records. Its pass bar: *every lap completed its own document once under
the live guard, every denial classified, none unexplained.*

### Tier 2 is the tier that would have caught this defect

Each of its assertions is written as the inverse of a way the bug could return:

| Assertion | The bug it forbids |
|---|---|
| `hooks.PreToolUse` is a non-empty array of matchers with a non-empty `hooks` array | the hook is never registered |
| `"canUseTool" in options === false` | **the wiring test fails if the guard is passed only as `canUseTool`** |
| the captured hook, given a real `PreToolUseHookInput`, returns `hookSpecificOutput.permissionDecision === "deny"` | the hook reads `(toolName, input)` positionally, or returns the `canUseTool` shape |
| a tool outside the lap's list is denied by that same hook | F2.1 regressed to narrowing-only |
| `Object.is(options.tools, run.tools)` | the banner and the hook computing lists separately |
| a denial through the hook appears in `.vibe-racer/audit.log` in a temp cwd | the audit path drifting from the refusal's path |
| no refusal contains `npm install @anthropic-ai/claude-agent-sdk` | the helpful-but-wrong fix being added back |
| `VERIFIED_SDK_VERSION` equals the `package.json` pin, with no caret | the constant and the pin drifting |
| `drive` registers no `--unguarded`-like flag and reads no such env var | F3.1 eroding |
| the only file under `src/` containing `canUseTool` is `guard-hook.ts` | the dead parameter coming back through a banner or a doc string |

### The one test written before its code

`M3` ships the two regression assertions as a single `it.fails(...)`; `M4` flips it to `it(...)`.
That is the whole of test-first in this task (Q5): the other tier-2 assertions are ordinary coverage
and land with their code. These two are different because they are the **regression** tests for a
shipped security defect, and a regression test that has never been red is a regression test on
trust.

### Conventions this task follows because the repo already does

- Mocked `node:fs` for filesystem units (`tests/claude/audit.test.ts`), real `mkdtempSync` cwds for
  the end-to-end audit assertion.
- `vi.mock("@anthropic-ai/claude-agent-sdk")` with a captured `query` for every tier-2 wiring test
  (`tests/claude/session.test.ts`).
- Table-driven cases over a pure function wherever the function is pure — `decideToolCall`,
  `toolsForSession`, `summary()` — the pattern `decideNextStep` established in `execute.test.ts`.
- One test file per module, named after it.

### Per-milestone gate, and the coverage rule

Every milestone ends with all four green, in this order:

```bash
npm run build && npm run typecheck && npm run lint && npm run test
```

**Coverage only goes up.** Baseline is **34 test files / 675 tests, all green**. A milestone that
keeps the suite green by deleting or skipping a test is not done. Three recorded exceptions, each
replacing what it removes with a strictly larger set:

1. `M1` deletes the two `canUseTool` cases in `tests/claude/session.test.ts`; `M4` restores their
   coverage through the captured hook.
2. `M1` retargets `tests/claude/guard.test.ts`'s message assertions onto rule ids, with the messages
   asserted once in the byte-identity table.
3. `M3` deletes the "skips write when file exceeds 1 MB" audit case, which asserts the behaviour
   F6.3 removes, and replaces it with four rotation cases.

---

## 15. Plan-level decisions

Five decisions this plan makes where `02_design.md` and the Q&A leave something open or in tension.
Each is reversible by striking the paragraph.

**D1 — Pre-flight reports its checks in the order 1, 2, 3, 4.** `02_design.md` §9.1 says "checks 1,
2 and 4 are synchronous and run first", while §9.2 says "checks 3 and 4 run in that order so a log
that is both tracked and unwritable reports `git rm --cached` first". Those cannot both describe the
reported order. This plan reads §9.1 as the explanation of why `preflight` is `async` at all, and
§9.2 as the rule about reported order — the one with a stated user-facing reason. Reported order is
**1, 2, 3, 4**, and `M5`'s test pins it.

**D2 — The red test at `M3` carries both assertions in one `it.fails`.** `M1` removes `canUseTool`
along with the dead function, so at `M3` the `canUseTool`-is-absent half already passes; an
`it.fails` over that assertion alone would fail the suite. One test asserting both throws at `M3` on
the hook-registration half, which preserves exactly what Q5 asks for — a red-to-green transition
inside `M4`'s diff — while keeping the suite green at `M3`. The `canUseTool` half is the standing
regression guard from `M1` onward, which is strictly earlier protection than Q5 asked for.

**D3 — The SDK `allowedTools` option survives `M2` and dies in `M4`.** `02_design.md` §5.4 drops it
and §20.2 flags the deviation. Dropping it in `M2` would leave `M2`'s computed list with no consumer
at all — the banner, its other consumer, is off for `M1`–`M3` per H1 — which is an unused value lint
would flag and a reviewer could not check. So `M2` changes **where the list comes from** and `M4`
changes **which option carries it**, in the same commit as the narrowing that replaces it. Under
`bypassPermissions`, `allowedTools` has no effect on what the model may call, so nothing observable
differs during the one-milestone overlap.

**D4 — `LAP_LABEL` lives in `src/pipeline/states.ts`, not in `guard-preflight.ts` or `skills.ts`.**
The refusal needs "product-review", which `LAP_BY_STAGE` (`skills.ts`) does not provide — it answers
a different question, "which skill list". `states.ts` already owns the human-facing stage label map
`STAGE_NEXT_NAME`, with the same "every consumer builds one sentence from it" comment. A third map in
a third file is how two of them end up disagreeing. **If struck**, the refusal says "the product lap"
from `LAP_BY_STAGE` and the objective's reference wording is not matched exactly.

**D5 — `GuardBypassError` lives in `guard-hook.ts`.** It is thrown by `session.ts` and caught by
`safe-wrapper.ts`, so it could justify its own module. It goes in `guard-hook.ts` because that is
where the bypass is detected and recorded, and because its `instanceof` identity must come from
exactly one place. The import is a type and a class only, and `safe-wrapper.ts` already imports from
`src/git/` and `src/state/`, so the direction adds no cycle.

---

## 16. Traceability: acceptance → milestone

| `01_product.md` §17 | Milestone |
|---|---|
| **A** — denials in a real session (write outside the plan folder, review-stage `Bash`, blocklist, out-of-list, Rule 0) | M1 (the rules) + M4 (they run) + **G3** (in a real session) |
| **B** — `hooks.PreToolUse` present, `canUseTool` absent, the wiring test discriminates, real input shape, the audit regression test, tier 1 via the decision function, a live tier exists, messages byte-identical | M3 (red) + M4 (green) + M1 (byte-identity) + M2 (live scaffolding) |
| **C** — four refusal triggers, the three-part message, no "install the SDK", non-zero exit with no side effect, no `--unguarded` | M5 |
| **D** — inline, collapsed, summarised; every denial audited; zero prints nothing; the path never the entries | M4 (inline + audit) + M6 (collapse + summary) |
| **E** — the three false-abort cases probed before the abort ships; the warning-only fallback; abort semantics; the retry gate | M7 + **G2** + M8 |
| **F** — self-ignoring `.vibe-racer/`, a tracked log refuses, rotation, this repo's `.gitignore`, documented contents | M3 + M5 (check 3) + M10 |
| **G** — the banner only when installed and showing the enforced list, `init` without `canUseTool`, `radio`'s notice | M4 (banner after the assert) + M6 |
| **H** — both gates are operator rows each followed by a milestone, every lap completed, every denial classified, narrowings recorded, the re-run done, the final table where QA reads it | **G3** + M9 + **G4** + M10 |
| **I** — CHANGELOG, the exact dated line, five documents naming the mechanism, the README admonition rewritten, the merge conflict named in `06_decision.md`, the three honest limits | M10, plus the `done` lap for `06_decision.md` |

| `02_design.md` section | Milestone |
|---|---|
| §4 `guard.ts` decide-only, rule order, rule ids, §4.5 deletions | M1 |
| §5 `tools.ts`, one value three ways, handler call sites | M2, plus M4 for the third consumer |
| §6 `guard-hook.ts` — hook body, suppression, summary | M4 (hook, audit, ids) + M6 (suppression, summary) |
| §7 `audit.ts` union, rotation, self-ignore, boolean return | M3 |
| §8 `session-options.ts`, `assertHookInstalled` | M4 |
| §9 `preflight`, four checks, renderer, two call sites | M5 |
| §10 heartbeat, `GuardBypassError`, wrapper branch, the planned fork | M7 (detect) + M8 (abort) |
| §11 SDK shapes, `tools` semantics, the stream read, the probe session, the canary | M4, plus M2 for the canary's home and M7 for the stream read |
| §12 state ownership, `state.yml` fields, the retry gate | M8 |
| §14 banners and notices | M4 (guard banner) + M6 (`init`, `radio`) |
| §15 the pin, `.gitignore` in two places | M5 (pin) + M3 (`.vibe-racer/.gitignore`) + M10 (this repo's) |
| §16 three tiers, the rewritten session test | M2 (scaffolding) + every milestone's own tier |
| §19 the unnamed tool families, the `fasten` manual check | M2 (corrected by Q2) + **G2** (`L7`) |

---

## 17. Closing note — what happens after the last milestone

The execute lap ends at `M10`. The task then goes to QA, which reviews `git diff main...HEAD` and
**needs the branch unmerged** to have something to review.

None of the following is a milestone, a gate or a checklist item anywhere in this plan. They are the
operator's, after `done`:

- merging this task's branch, and resolving the **expected README conflict in favour of the branch**
  — `main` will have changed that paragraph after the branch was cut, and the `done` lap writes this
  into `06_decision.md` so it is not a surprise at merge time;
- the version number: `main` already carries #5's unreleased work, so the release containing this fix
  is not a patch of 0.3.0 unless it is cut from a `v0.3.0` hotfix branch;
- publishing, and `npm deprecate vibe-racer@0.3.0` with a one-line pointer at the fixed version.
  **Nothing shipped in this task can warn a 0.3.0 user**, which is why `npm deprecate` carries the
  weight and must not be skipped;
- removing the driver worktree from `G1`: `git worktree remove ../vibe-racer-main`. `06_decision.md`
  says so;
- #6 (`drive-enforcements`) races after this task merges: the no-push deny list, the merge ban in
  plans, and `drive` on the task branch.
