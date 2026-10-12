# Design Specification for #7: guard-actually-runs

> **Role**: Senior Software Architect
> **Stage**: `ai_design_review` → `need_plan`
> **Date**: 2026-10-12
> **Source answers**: `02_design_questions.md` Q1–Q6 (all answered and ticked)
> **Upstream**: `01_product.md` F1–F10, §17 acceptance; `00_objective.md` C1–C4
> **Probed against**: `@anthropic-ai/claude-agent-sdk` 0.3.270 (type surface in `node_modules` read during this lap; the live probes are not re-run here)

---

## Table of Contents

1. [Scope of this document](#1-scope-of-this-document)
2. [Architecture overview](#2-architecture-overview)
3. [Directory structure](#3-directory-structure)
4. [Module: `guard.ts` — the decision core](#4-module-guardts--the-decision-core)
5. [Module: `tools.ts` — the lap's tool list](#5-module-toolsts--the-laps-tool-list)
6. [Module: `guard-hook.ts` — per-session run](#6-module-guard-hookts--per-session-run)
7. [Module: `audit.ts` — evidence](#7-module-auditts--evidence)
8. [Module: `session-options.ts` — one options object](#8-module-session-optionsts--one-options-object)
9. [Module: `guard-preflight.ts` — refusing before spend](#9-module-guard-preflightts--refusing-before-spend)
10. [The heartbeat and the bypass contract](#10-the-heartbeat-and-the-bypass-contract)
11. [SDK integration patterns](#11-sdk-integration-patterns)
12. [State management design](#12-state-management-design)
13. [Data flow](#13-data-flow)
14. [Banners, notices and CLI surfaces](#14-banners-notices-and-cli-surfaces)
15. [Configuration and environment](#15-configuration-and-environment)
16. [Testing strategy](#16-testing-strategy)
17. [Build and distribution](#17-build-and-distribution)
18. [Dependency summary](#18-dependency-summary)
19. [Gaps this design surfaces](#19-gaps-this-design-surfaces)
20. [Deviations from the Q&A, with rationale](#20-deviations-from-the-qa-with-rationale)
21. [Traceability](#21-traceability)

---

## 1. Scope of this document

`01_product.md` settles what the guard does. Q1–Q6 settle the module boundaries. This document is
the contract between them: the exact types, the exact import directions, the exact order rules are
evaluated in, and the exact places where an invariant is made structural rather than remembered.

**Inputs treated as settled, not re-litigated here:** transport is a `PreToolUse` hook with
`canUseTool` dropped (C1, F1); context narrowing uses the SDK `tools` option (C2, F2.2); the SDK is
pinned exactly (C3.1); three test tiers (C4); and every behaviour in F1–F10.

**The one architectural pressure driving every decision below.** `createToolGuard` is a single
400-line closure that decides, formats, logs, audits and returns an SDK-shaped `PermissionResult`
in one function. Five new consumers now need parts of it: a hook, a pre-flight check, a denial
accumulator, a heartbeat and three test tiers. Q1's answer — the seam is **decide-only** — is what
makes the other five tractable, so §4 is the load-bearing section and everything after it depends
on `guard.ts` performing no I/O.

---

## 2. Architecture overview

### 2.1 What changes, in one diagram

```
BEFORE (0.3.0 — the defect)                 AFTER (this task)

  model emits tool_use                        model emits tool_use
          |                                            |
          v                                            v
  +-------------------+                      +------------------------+
  | bypassPermissions |                      | PreToolUse hook        |--> decideToolCall()
  |  auto-approves    |                      |  (no matcher)          |    (pure, no I/O)
  +-------------------+                      +------------------------+
          |                                       |            |
          |  canUseTool never consulted           | allow      | deny
          v                                       v            v
      TOOL RUNS                               TOOL RUNS   TOOL DOES NOT RUN
          :                                                 - log.warn (first of pair)
          : guard never invoked                              - audit entry (always)
          v                                                  - permissionDecisionReason
  +-------------------+                                   |
  | canUseTool(...)   |  <- dead code                     v
  +-------------------+                             bypassPermissions auto-approves
                                                    only what the hook allowed
```

### 2.2 Module graph and import direction

Arrows point from importer to imported. The direction is the design: **`guard.ts` is a leaf**, for
the same reason `markdown-scan.ts` is one.

```
          src/cli/drive.ts ----------------+
          src/cli/fasten.ts ---------------+
                                           v
                              src/claude/guard-preflight.ts
                                   |        |          |
            +----------------------+        |          +------------+
            v                               v                       v
  src/claude/session-options.ts    src/claude/audit.ts     src/git/operations.ts
            |        |                      ^
            |        +----------+           |
            v                   v           |
  src/claude/tools.ts   src/claude/guard-hook.ts
            ^                   |   |
            |                   |   +-------+
            |                   v
            |         src/claude/guard.ts  -->  node:fs . node:path . node:os
            +-------------------+                (and nothing else)

  src/claude/session.ts        --> session-options.ts, guard-hook.ts, tools.ts, skills.ts, prompts.ts
  src/pipeline/handlers/*.ts   --> session.ts, tools.ts
```

**Two invariants held by direction, not by discipline:**

| Invariant | Enforced by |
|---|---|
| `guard.ts` can be pulled into a prompt, a doc generator or a browser-side check without dragging the SDK in | it imports no SDK types, no logger, no audit (Q1) |
| Pre-flight never touches the module that runs sessions | `guard-preflight.ts` imports `session-options.ts`, **never** `session.ts` (§20.1) |

A lint rule or a one-line test asserts both by reading the import lists — the same technique
`markdown-scan.ts` is protected by.

### 2.3 The consumers of one decision

```
                      +------------------------------------------+
                      |  decideToolCall(options)(tool, input)    |
                      |          -> GuardDecision                |
                      +------------------------------------------+
                         ^         ^         ^         ^
      tier-1 rule tests -+         |         |         +- a future doc/prompt consumer
                                   |         |
                 GuardRun.hook ----+         +---- (nothing else — pre-flight asserts
                 (logs, audits, records id)         *shape*, never decides)
```

---

## 3. Directory structure

```
src/
  claude/
    guard.ts              -- CHANGED: createToolGuard -> decideToolCall; zero I/O; zero SDK imports
    guard-hook.ts         -- NEW:     createGuardRun -> GuardRun (hook, sawToolUse, summary, recordBypass)
    guard-preflight.ts    -- NEW:     preflight(cwd) -> PreflightResult; VERIFIED_SDK_VERSION
    tools.ts              -- NEW:     TOOLS_BY_STAGE, DECISION_TOOLS, FASTEN_TOOLS, toolsForSession
    session-options.ts    -- NEW:     buildSessionOptions(...), assertHookInstalled(...)
    session.ts            -- CHANGED: one GuardRun per session; hook wiring; heartbeat; abortController
    audit.ts              -- CHANGED: AuditEntry union, rotation, ensureAuditDir, auditLogPath, boolean return
    fasten.ts             -- CHANGED: passes FASTEN_TOOLS as explicit override
    skills.ts             -- unchanged
    prompts.ts            -- unchanged
  cli/
    drive.ts              -- CHANGED: preflight before checkoutBranch; bypass retry gate
    fasten.ts             -- CHANGED: preflight before runFastenAnalysis
    radio.ts              -- CHANGED: one-line unguarded notice
    init.ts               -- CHANGED: banner no longer names canUseTool
  git/
    operations.ts         -- CHANGED: commitPaths, isPathTracked, isTreeClean
  pipeline/handlers/
    *.ts                  -- CHANGED: ALLOWED_TOOLS literals deleted; tools come from tools.ts
    safe-wrapper.ts       -- CHANGED: GuardBypassError branch
  state/
    schema.ts             -- CHANGED: guard_bypass, guard_bypass_version
    store.ts              -- CHANGED: setError gains an optional extra-fields parameter

tests/
  claude/guard.test.ts        -- tier 1, retargeted onto decideToolCall
  claude/guard-hook.test.ts   -- NEW tier 1/2: suppression, summary, audit-on-deny, bypass entry
  claude/preflight.test.ts    -- NEW tier 2: four triggers, first-failure-only, order of 3 before 4
  claude/session.test.ts      -- tier 2, rewritten: hooks.PreToolUse present, canUseTool absent
  claude/heartbeat.test.ts    -- NEW tier 2: synthetic stream, unseen tool_result -> GuardBypassError
  claude/tools.test.ts        -- NEW tier 1: per-stage lists, Skill allowance, fasten override
  cli/drive-retry.test.ts     -- NEW tier 2: bypass retry gate, both conditions, messages
  live/                       -- NEW tier 3, opt-in: npm run test:live
    hook-fires.live.test.ts
    out-of-list.live.test.ts
    settings-regrant.live.test.ts
    false-abort.live.test.ts
    mcp-context.live.test.ts
```

---

## 4. Module: `guard.ts` — the decision core

*Answers Q1. Satisfies F1.1–F1.3.*

### 4.1 Public surface

```ts
// src/claude/guard.ts — imports: node:fs, node:path, node:os. Nothing else, ever.

export type GuardRuleId =
  | "state-yml"          // Rule 0  — state.yml is pipeline-owned
  | "sensitive-path"     // Rule 1  — ~/.ssh, ~/.aws, /etc/shadow, ... (and Bash path references)
  | "path-jail"          // Rule 2  — outside cwd + tmpdir (and Bash path references)
  | "dotenv"             // Rule 3  — .env, .env.*
  | "plan-jail"          // Rule 4a — Write/Edit restricted to the task plan folder
  | "bash-review-stage"  // Rule 4b — review laps may not shell out
  | "bash-blocklist"     // Rule 5  — BASH_BLOCKLIST + destructive rm
  | "bash-network"       // Rule 5  — interpreter-aware network detection
  | "tool-not-in-list"   // NEW     — F2.1 default-deny
  | "internal-error";    // the deny-by-default on an exception

export type GuardDecision =
  | { behavior: "allow" }
  | {
      behavior: "deny";
      tool: string;        // toolName as received
      input: string;       // the existing one-line input summary
      reason: string;      // the existing reason text, byte-identical
      rule: GuardRuleId;   // NEW — stable id for tests and for summary grouping
    };

export interface GuardOptions {
  cwd: string;
  stage: Stage;
  taskPlanPath: string;
  plansDir: string;
  /** F2.1: the lap's list. A tool outside it is `tool-not-in-list`. */
  tools: readonly string[];
  /** See the existing doc comment — two sessions share `cleanup_ready`. */
  jailToPlanDir?: boolean;
}

export function decideToolCall(
  options: GuardOptions,
): (toolName: string, input: Record<string, unknown>) => GuardDecision;

export function formatGuardSummary(
  stage: Stage,
  tools: readonly string[],
  jailToPlanDir?: boolean,
): string;

// Rule constants stay exported from here: BASH_BLOCKLIST, PLAN_JAILED_STAGES,
// BASH_BLOCKED_STAGES, SENSITIVE_PATHS, SENSITIVE_ABSOLUTE, NETWORK_SIGNATURES,
// INTERPRETER_EXEC_FLAGS, PATH_TOOLS.
```

`decideToolCall` is **synchronous**. The old `canUseTool` had to be `async` because the SDK's type
demanded it; nothing in the rule body awaits. The hook wrapper is the `async` boundary.

`Stage` is the one type imported from outside `node:*` — a string-union type, erased at build, no
runtime edge. It does not weaken the leaf property.

### 4.2 Rule evaluation order

The order below is **not** the order in today's source. One rule is inserted and one is deleted,
and the ordering argument is what keeps F1.3 ("messages byte-identical") true.

| # | Rule | id | Condition | Message |
|---|---|---|---|---|
| 1 | review-stage Bash | `bash-review-stage` | `BASH_BLOCKED_STAGES.has(stage) && tool === "Bash"` | `review stage: bash not permitted` |
| 2 | **membership** | `tool-not-in-list` | `!tools.includes(tool)` | `not available at this stage (<stage>)` |
| 3 | state.yml | `state-yml` | Write/Edit, basename `state.yml` under `plansDir` | `state.yml is owned by the pipeline` |
| 4 | sensitive path | `sensitive-path` | path-bearing tool, `isSensitivePath` | `sensitive path` |
| 5 | path containment | `path-jail` | path-bearing tool, `!isWithinAllowed` | `path outside project directory` |
| 6 | dotenv | `dotenv` | basename matches `^\.env(\..+)?$` | `file may contain secrets` |
| 7 | plan jail | `plan-jail` | Write/Edit and (`jailToPlanDir` or jailed stage) | `writes restricted to <taskPlanPath>/` |
| 8 | Bash filter | see §4.3 | `checkBashCommand` | unchanged |
| — | default | — | — | `allow` |
| — | `catch` | `internal-error` | any throw above | `Internal guard error: <msg>` |

**Why membership sits at 2 and not at 1.** No review lap lists `Bash` (F2's table). With membership
first, rule 1 becomes unreachable, its message silently changes to the membership message, and
`bash-review-stage` quietly dies as a rule — against F1.3 and against "guardrails only tighten"
(a list that later gains `Bash` by accident would re-open shelling out at a review stage). Rule 1
evaluated first keeps the message byte-identical and the rule live. Q5 names this; it is restated
here because it is the single most invertible line in the whole module.

**Why membership at 2 cannot change any other message.** For a tool that *is* in the list,
membership is a no-op, so rules 3–8 fire exactly as they do today for every tool any lap offers.
The only calls whose outcome changes are calls to tools no lap offers — which today are allowed and
after this task are denied. That is the intended tightening, not a message change.

**Deleted: the unconditional `Skill` allow.** Today `if (toolName === "Skill") return allow` sits
between rules 1 and 8 (`guard.ts:363`). Membership subsumes it: `toolsForSession` puts `Skill` in
the list exactly when the lap resolved skills (§5), so `Skill` is allowed when it should be and is
`tool-not-in-list` when no skill was resolved. A hard-coded unconditional allow that outlives its
reason is the rule class this whole task exists to delete.

### 4.3 The rule-id mapping, including the two reused ids

`checkBashCommand` produces four distinct messages. Two of them are *the path rules applied to a
Bash command string*, so they take the path rules' ids rather than inventing `bash-path-ref`:

| Message | id | Note |
|---|---|---|
| `Blocked command: <cmd>`, `Blocked command: destructive rm` | `bash-blocklist` | |
| `Interpreter network call: <interp> inline code with <sig>` | `bash-network` | |
| `References sensitive path: <match>` | `sensitive-path` | same rule, different tool |
| `References path outside project: <match>` | `path-jail` | same rule, different tool |

The id names the **rule**; `tool` already distinguishes the `Bash` route from the `Read`/`Write`
route, and a tier-1 test asserting `rule: "path-jail"` for both is asserting the thing that
matters. A future `vibe-racer audit` grouping by `rule` then shows `path-jail: 11` rather than two
rows that are the same finding.

### 4.4 One honest wrinkle in Q2's suppression key

Q2 states "`reason` never contains the input, so the key stays stable across retries." That holds
for eight of the ten rules. It does **not** hold for the two rows above (`References sensitive
path: ~/.ssh/id_rsa`) or for `internal-error` (`Internal guard error: <err.message>`), where the
reason embeds a fragment of the input.

Consequence, stated rather than discovered: an agent that references three different out-of-project
paths in three `Bash` commands prints three inline lines and gets three summary rows, not one.
**That is correct behaviour** — they are three different things it tried — and it is also the only
case where F4's "collapse duplicates" collapses less than a reader might expect. The alternative
(normalising the path out of the reason) would change the message text and break F1.3. No code
change; this paragraph is the design decision, and `docs/security.md` gets one sentence of it.

### 4.5 What is deleted from `guard.ts`

- `createToolGuard` and its inner `deny()` helper — the four-things-at-once function.
- `import type { CanUseTool, PermissionResult }`, `import { log }`, `import { appendAuditEntry }`.
- The `Skill` early allow (§4.2).

`formatGuardSummary` **stays** in `guard.ts`: it reads `PLAN_JAILED_STAGES` and
`BASH_BLOCKED_STAGES` and its whole contract (F7.4) is to mirror rule conditions, so it has to live
beside them. Its second parameter is renamed `allowedTools` to `tools` and widened to
`readonly string[]`, which is the type `tools.ts` hands out.

---

## 5. Module: `tools.ts` — the lap's tool list

*Answers Q5. Satisfies F2.1–F2.3, F7.2.*

### 5.1 Public surface

```ts
// src/claude/tools.ts — imports: the `Stage` type. Nothing else.

export const TOOLS_BY_STAGE: Partial<Record<Stage, readonly string[]>> = {
  ai_objective_review: ["Read", "Glob", "Grep", "Write"],
  ai_product_review:   ["Read", "Glob", "Grep", "Write"],
  ai_design_review:    ["Read", "Glob", "Grep", "Write"],
  ai_plan_review:      ["Read", "Glob", "Grep", "Write"],
  ready_to_execute:    ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
  ai_qa:               ["Read", "Glob", "Grep", "Write", "Bash"],
  cleanup_ready:       ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],  // cleanup session
} as const;

/** The second `cleanup_ready` session. Stage alone cannot tell them apart — see jailToPlanDir. */
export const DECISION_TOOLS: readonly string[] = ["Read", "Glob", "Grep", "Write"];

/** `fasten` is not a lap. Read-only, per 01_product.md §18.2. */
export const FASTEN_TOOLS: readonly string[] = ["Read", "Glob", "Grep"];

export function toolsForSession(opts: {
  stage: Stage;
  /** Explicit list, for the sessions a stage cannot identify: DECISION_TOOLS, FASTEN_TOOLS. */
  override?: readonly string[];
  /** True when skills resolved to at least one installed skill (F2's Skill allowance). */
  withSkill?: boolean;
}): readonly string[];
```

`toolsForSession` returns a **frozen array**, and returns `[]` for a stage with no entry and no
override. An empty list is not a bug to tolerate: the hook denies everything, the session is
useless, and that is strictly safer than falling back to a permissive default. A tier-1 test pins
that every agent stage has an entry, so the empty case cannot be reached by a stage that should
have had one.

### 5.2 Why the stage map is not sufficient alone

`cleanup_ready` runs two sessions with different needs — exactly the reason `jailToPlanDir` exists.
The override parameter is the mechanism, and it lives in `tools.ts` next to the table it overrides
rather than as a literal at `done.ts:37`. `done.ts` passes `DECISION_TOOLS`; `fasten.ts` passes
`FASTEN_TOOLS`.

### 5.3 One value, three consumers

```
toolsForSession({stage, override, withSkill})
            |
            +--> one frozen readonly string[] --+--> SDK `tools` option   (narrowing, F2.2)
                                                 +--> GuardOptions.tools   (default-deny, F2.1)
                                                 +--> formatGuardSummary   (banner, F7.2)
```

This is the whole of F7's "the banner cannot lie": not a convention that three call sites compute
the same thing, but one value threaded three ways from one source. `buildSessionOptions` (§8) is
where the thread is tied, and a tier-2 test asserts identity (`Object.is`) between the array in
`options.tools` and the array the `GuardRun` holds — identity, not deep equality, because deep
equality would pass for two independently computed lists that happen to agree today.

### 5.4 `allowedTools` is dropped

Under `permissionMode: "bypassPermissions"` the `allowedTools` auto-approve list has no effect on
what the model may call — that is the defect this task exists to fix, restated. Keeping it as a
second list that must agree with `tools` is a drift surface with no benefit, and its presence is
part of why the old banner looked plausible. `session.ts` passes **`tools` only**. See §20.2.

The SDK's own note on `tools` ("native builds may provide search via Bash `find`/`grep` instead of
the dedicated Grep/Glob tools — list Grep/Glob here or in `allowedTools`") is satisfied: every list
above names `Grep` and `Glob` explicitly (F2.3). The live tier confirms search still works with
`tools`-only and no `allowedTools` (§16.3, L2).

### 5.5 Handler call sites removed

Seven literals collapse into the table: `qa.ts:17`, `done.ts:11`, `done.ts:12`,
`review-runner.ts:12`, `objective-review.ts:10`, `execute.ts:61`, `fasten.ts:114`. After this task,
a handler passes no tool list at all for the common case — `runAndStream` derives it from `stage`
the same way it already derives `lap` from `stage` via `LAP_BY_STAGE`. Only the two
can't-tell-from-stage sessions pass an override. **A grep for `"Read", "Glob", "Grep"` under
`src/pipeline/` and in `src/claude/fasten.ts` returning nothing is the completion test for that
milestone.**

---

## 6. Module: `guard-hook.ts` — per-session run

*Answers Q2. Satisfies F1.1, F1.2, F4.1–F4.4, F5.4.*

### 6.1 Public surface

```ts
// src/claude/guard-hook.ts
import type { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

export interface DenialSummary {
  total: number;                                       // every denial, incl. suppressed ones
  groups: { tool: string; rule: GuardRuleId; reason: string; count: number }[];
  logPath: string;
}

export interface GuardRun {
  /** Register under options.hooks.PreToolUse. Decides, logs, audits, records the id. */
  hook: HookCallback;
  /** F5: has the hook seen this tool_use_id? */
  sawToolUse(id: string): boolean;
  /** F4.1: null when there were no denials — the caller prints nothing. */
  summary(): DenialSummary | null;
  /** F5.4: audit the bypass as its own entry type. */
  recordBypass(toolName: string, toolUseId: string): void;
  /** F2/F7: the exact list this run enforces, for the banner and for tier-2 identity. */
  readonly tools: readonly string[];
}

export function createGuardRun(options: GuardOptions): GuardRun;

/** The one place the user-visible denial string is assembled. */
export function formatDenial(d: Extract<GuardDecision, { behavior: "deny" }>): string;
//   -> `Denied: ${tool} ${input} — ${reason}`   (byte-identical to today)

/** Pre-flight check 2 and the pre-`query` re-assertion both call this. Lives here, not in
 *  session.ts, so `guard-preflight.ts` need not import the session runner. */
export function assertHookInstalled(options: unknown): { ok: true } | { ok: false; what: string };
```

### 6.2 Per-session state, and why it is a factory

```
createGuardRun(options)
  |-- seen:      Set<string>                       // tool_use_ids the hook was invoked for
  |-- printed:   Set<string>                       // tool + NUL + rule + NUL + reason -> suppression
  |-- counts:    Map<string, {tool, rule, reason, count}>
  +-- tools:     readonly string[]                 // frozen, from toolsForSession
```

No module-level mutable state exists in any guard module. Two sessions run in one process at
`cleanup_ready` (cleanup, then decision), and the denial tally is **reported to the user** — a
shared `Map` would make the decision session's summary include the cleanup session's denials. That
is a correctness bug in a security surface, not untidiness, which is why the factory is the design
and not a style preference.

The suppression key separator is `U+0000`, not `|`, because `reason` can contain any character
(a path, a command, an error message) and a separator that can appear inside a field is a collision
waiting to be found by exactly the adversarial input this module exists to handle.

### 6.3 The hook body

```ts
const hook: HookCallback = async (input, toolUseID) => {
  if (input.hook_event_name !== "PreToolUse") return {};          // registered with no matcher
  const { tool_name, tool_input, tool_use_id } = input as PreToolUseHookInput;
  const id = tool_use_id ?? toolUseID;
  if (id) seen.add(id);                                           // BEFORE deciding — see below

  const decision = decide(tool_name, (tool_input ?? {}) as Record<string, unknown>);
  if (decision.behavior === "allow") return {};                   // {} => no opinion => proceed

  const msg = formatDenial(decision);
  const key = [decision.tool, decision.rule, decision.reason].join(" ");
  if (!printed.has(key)) { printed.add(key); log.warn(msg); }     // F4 inline, first of pair
  bump(counts, key, decision);                                    // F4.4 every denial counted

  const written = appendAuditEntry(cwd, { kind: "denial", ts, stage, tool, input, reason, rule });
  if (!written) log.error(`Audit entry not written — ${auditLogPath(cwd)}`);   // Q6

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: msg,
    },
  };
};
```

Four decisions pinned by that body:

| Decision | Why |
|---|---|
| The id is recorded **before** the decision, for denied calls too | A denied call still has a `tool_use_id` and the SDK may still emit a `tool_result` carrying the denial. Recording only allowed ids would make every denial look like a bypass and abort the session — a self-inflicted false abort of exactly the kind F5's probe exists to rule out |
| `allow` returns `{}`, not `permissionDecision: "allow"` | Under `bypassPermissions` the session auto-approves anyway; returning `"allow"` would make the hook an *approver* rather than a *vetoer*, which is a larger claim than this task ships |
| The audit append happens **inside** the hook, before it returns | A session killed by the heartbeat or by `maxTurns` must still have every denial on disk (Q2) |
| An unwritable audit log still **denies** | The deny decision was already made; an unrecordable denial is not an allow (Q6). Promoting it to an abort would hand a read-only `.vibe-racer/` the power to kill a lap mid-flight — the exact case pre-flight check 4 exists to catch *before* anything is spent |

### 6.4 `summary()` is pure and idempotent

It reads `counts` and returns a fresh object; it mutates nothing. The `finally` that prints it can
therefore run on both the success and the error path (F4.3) without double-counting, and
`runAndStream` does not need to remember whether it already printed. Returning `null` for zero
denials puts F4.1 in the data model rather than in an `if` at each call site — including both
`cleanup_ready` sites.

`groups` is sorted by `count` descending, then `tool`, then `rule` — a deterministic order, because
this block gets pasted into issues and a stable order makes two pastes comparable.

---

## 7. Module: `audit.ts` — evidence

*Answers Q6. Satisfies F6.1, F6.3, F6.4, F5.4, F4.2.*

### 7.1 Public surface

```ts
export const MAX_AUDIT_SIZE = 1024 * 1024;   // 1 MB, unchanged

export type DenialEntry = {
  kind: "denial";
  ts: string; stage: string; tool: string; input: string; reason: string;  // the five, unchanged
  rule: GuardRuleId;                                                      // NEW (Q1)
};

export type BypassEntry = {
  kind: "bypass";
  ts: string; stage: string; tool: string;
  tool_use_id: string;
  version: string;                 // the vibe-racer version that hit it (F5.5)
};

export type AuditEntry = DenialEntry | BypassEntry;

export function auditLogPath(cwd: string): string;             // one definition (Q6)
export function ensureAuditDir(cwd: string): boolean;          // mkdir + .vibe-racer/.gitignore
export function appendAuditEntry(cwd: string, e: AuditEntry): boolean;   // false => not on disk
```

### 7.2 Behaviour changes

| Today | After |
|---|---|
| `catch {}` — swallows every failure | `return false`. **Still never throws** — a guard that crashes because it could not write a log is worse than one that denies and reports. But the caller now knows |
| At or above 1 MB, `return` silently; entries are lost | `renameSync(audit.log -> audit.log.1)` replacing any previous `.1`, then append to a fresh file. Bounded at two files; no entry discarded (F6.3) |
| Directory created implicitly by `mkdirSync` | `ensureAuditDir` also writes `.vibe-racer/.gitignore` containing `*`, **existing content never overwritten**. Called from `preflight` and idempotently from the append path, so F6.1 holds for projects initialised before this release without `init` and the guard each owning a copy of the rule |
| No entry kinds | Tagged union on `kind`. One JSON object per line as today; adding a field is backward-compatible for anything already reading the file, and the discriminator is what lets the deferred `vibe-racer audit` tell a denial from a bypass without inferring from which fields are present |
| Three hand-written `resolve(cwd, ".vibe-racer", "audit.log")` | `auditLogPath` exported and used by `preflight`, `appendAuditEntry` and `DenialSummary`. Three literals is how a refusal ends up checking a different file from the one the guard writes |

### 7.3 Rotation is checked on the existing `statSync`

No extra syscall per entry: the `statSync` already in the function is the rotation trigger. A
rotation failure returns `false` like any other failure. The `.1` file is *replaced*, not appended —
two files, bounded, as F6.3 says.

**Field-order note.** `kind` is written first in each JSON object so a human running `tail -f` on
the log can tell entry types apart at a glance. `JSON.stringify` preserves insertion order for
string keys, so this is a property of the object literal and a tier-1 test pins it.

---

## 8. Module: `session-options.ts` — one options object

*Implements Q3 check 2, with the placement refinement of §20.1.*

### 8.1 Public surface

```ts
export interface BuiltSession {
  prompt: string;
  options: Options;                 // the SDK's Options, exactly as `query` takes it
  run: GuardRun | null;             // null only for the unguarded skill-discovery probe
}

export function buildSessionOptions(input: {
  prompt: string;
  persona: string;                  // already including any skills section
  cwd: string;
  stage?: Stage;
  taskPlanPath?: string;
  plansDir?: string;
  tools?: readonly string[];        // from toolsForSession; required when `stage` is set
  maxTurns?: number;
  jailToPlanDir?: boolean;
  abortController: AbortController;
}): BuiltSession;
```

`buildSessionOptions` is **pure and synchronous**. Skill resolution is async and happens before it
in `runAndStream`; by the time options are built, the persona string and the `withSkill` flag are
already decided. That is what lets pre-flight call the same function with a representative input
and get a real options object without starting anything.

### 8.2 The object it builds

```ts
{
  cwd,
  systemPrompt: { type: "preset", preset: "claude_code", append: persona },
  settingSources: ["project", "user"],
  tools,                              // <- narrowing (F2.2); no `allowedTools` (§5.4)
  maxTurns,
  includePartialMessages: true,
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  abortController,                    // <- heartbeat (§10)
  hooks: { PreToolUse: [{ hooks: [run.hook] }] },   // <- no matcher: every tool call (F1.1)
  // canUseTool: ABSENT — F1.4
}
```

`{ hooks: [run.hook] }` with **no `matcher` key** is what F1.1 rests on: a `HookCallbackMatcher`
without a matcher receives every tool call, including tools no lap listed and tools the project's
own settings re-grant (E5).

### 8.3 `assertHookInstalled`

Lives in `guard-hook.ts` (§6.1) and is called from **two** places on the same shape:

1. `preflight` — on a representative build, which is all it can see (Q3).
2. `runAndStream` — on the **real** options object, on the line before `query(...)`, throwing if it
   fails. Still before anything is spent on that session.

It asserts three things: `hooks.PreToolUse` is a non-empty array, its first matcher's `hooks` array
is non-empty, and `"canUseTool" in options === false`. The third is the tiers-1–2 stand-in for the
`process.on("warning")` listener, which cannot fire when `query` is mocked (C4).

---

## 9. Module: `guard-preflight.ts` — refusing before spend

*Answers Q3. Satisfies F3.1–F3.6, F6.1, F6.2.*

### 9.1 Public surface

```ts
export const VERIFIED_SDK_VERSION = "0.3.270";

export type PreflightResult =
  | { ok: true }
  | { ok: false; what: string; fix: string | null };   // fix === null => internal defect, report it

export function preflight(cwd: string): Promise<PreflightResult>;
```

Returning the **first** failure as a single value — not an array — makes F3's "report only the
first" structural rather than a caller's discipline. `fix: null` is the typed way to say "there is
no command you can run; this is our defect" (check 2), so the renderer needs no special case for a
missing fix line.

`preflight` is `async` because check 3 asks git. Checks 1, 2 and 4 are synchronous and run first,
so a broken install refuses without spawning a git process.

### 9.2 The four checks

| # | Check | Mechanism | `what` / `fix` |
|---|---|---|---|
| 1 | SDK version | `createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk")`, then read `package.json` **from that file's directory**, then string equality against `VERIFIED_SDK_VERSION` | found-vs-verified; fix names reinstalling vibe-racer or removing the `overrides` entry |
| 2 | Hook registered | `assertHookInstalled(buildSessionOptions(representative))` | internal defect; `fix: null` |
| 3 | Audit log untracked | `git.raw(["ls-files", "--error-unmatch", ".vibe-racer/audit.log"])` — exit status is the answer, no parsing. Not a git repo => skip silently | `git rm --cached .vibe-racer/audit.log` |
| 4 | Writable | `ensureAuditDir(cwd)`, then `openSync(path, "a")` + `closeSync` | names the path it could not write |

**Why the SDK's own `package.json` and not ours.** Reading vibe-racer's `dependencies` would echo
the pin back and verify nothing. Resolving from the installed SDK is what makes an `overrides`
entry or a hand-linked SDK visible — the only two ways the pin can be defeated.

**Why the main entry and not the `./package.json` subpath.** The package's `exports` map does not
expose `./package.json`; resolving that subpath throws `ERR_PACKAGE_PATH_NOT_EXPORTED` (checked
against 0.3.270), which would turn every single `drive` into a refusal. The main-entry route was
checked and returns `0.3.270`. A failure to resolve or parse is itself a **refusal** — "the SDK
version could not be read" — never a pass. Fail-closed is the only direction available to a check
whose job is to prove enforcement exists.

**No `semver` dependency.** Equality on an exact pin is a string compare. That is the whole point
of C3.1.

**Drift between the constant and the pin** is caught by a test that reads
`package.json -> dependencies["@anthropic-ai/claude-agent-sdk"]` and asserts it equals
`VERIFIED_SDK_VERSION` exactly (no caret, no range). Bumping the SDK then fails the suite until
someone edits both and re-runs the live probes — which is the deliberate act C3.1 asks for.

**Order.** Checks 3 and 4 run in that order so a log that is both tracked and unwritable reports
`git rm --cached` first: the prerequisite fix. Within 1–2, the install checks run before the
project checks so a mismatched SDK is not masked by a project problem the user would fix first for
nothing.

### 9.3 Call sites — exactly two

```
driveCommand(opts)
  |- checkPrerequisites()                      (existing)
  |- loadConfig, discoverTasks                 (reads only)
  |- tryAdvance loop over human stages         (reads + state writes for ticks — unchanged)
  |- selectTask                                (reads only)
  |- if (!selected) return                     <- no lap to run => NO pre-flight
  |
  |- * PREFLIGHT(cwd)  ---- !ok --> render refusal, exit != 0
  |                                 (no branch, no commit, no state write — F3.3, F3.5)
  |- checkoutBranch(git, branchName)           <- drive.ts:197, now after pre-flight
  |- error-stage resolution + bypass retry gate (§12.3)
  +- dispatch(target, ctx)

fastenCommand(opts)
  |- loadConfig, discoverTasks, active-plan check
  |- * PREFLIGHT(cwd)  ---- !ok --> render refusal, exit != 0
  +- runFastenAnalysis(cwd)                    <- a guarded session (§5.1 FASTEN_TOOLS)
```

**Why after task selection and not after `loadConfig`.** Running pre-flight earlier is wrong three
ways: it refuses a `drive` that has no lap to run; it blocks `finalizeTask`'s commit of a finished
task (`drive.ts:33`, the other `checkoutBranch`, which starts no session) over an SDK mismatch that
task no longer cares about; and it cannot name the lap, which the reference message does
("Refusing to start the product-review lap").

**Why not inside `runAndStream`.** By then the handler is dispatched and the branch is checked out,
so "nothing was spent" would be true of tokens and false of the working copy.

**Why not in each handler.** Seven call sites for one invariant is how check 3 ends up missing from
one of them.

**Why `fasten` too.** It starts a guarded session (`01_product.md` §18.2), and "a session that
cannot be guarded does not start" must not have a second entry point that skips the four checks.
Two call sites, one function, one renderer.

### 9.4 The refusal renderer

One function, shared by `drive.ts` and `fasten.ts`:

```
Refusing to start the <lap-name> lap: <what>.
No session was started and nothing was spent.
-> <fix>                                                (omitted when fix === null)
If you want an unguarded agent in this repository, run `claude` directly.
```

The last line is Q1's acknowledgement of the legitimate need. For `fasten` the first line names the
analysis rather than a lap. The three-part contract is assembled here and **only** here, so every
trigger inherits it — including triggers added by a later task.

The SDK-mismatch `fix` must never read "install the SDK": vibe-racer is a globally installed CLI,
the SDK lives inside its own install, and `npm install @anthropic-ai/claude-agent-sdk@...` in the
user's project would add a package to *their* repository and change nothing. A tier-2 test asserts
the string `npm install @anthropic-ai/claude-agent-sdk` does not appear in any refusal message — a
negative assertion, because this is a sentence someone will helpfully add back.

---

## 10. The heartbeat and the bypass contract

*Answers Q4. Satisfies F5.1–F5.5, and the planned fork of F5's blocking prerequisite.*

### 10.1 The four layers

```
+- 1. DETECT -----------------------------------------------------------------+
| for await (const message of query({...})) {                                 |
|   if (message.type === "user") {                                            |
|     for (const block of toolResultBlocks(message)) {                        |
|       if (!run.sawToolUse(block.tool_use_id)) {                             |
|         aborting = true;                   // distinguishes us from SIGINT  |
|         run.recordBypass(nameFor(block), block.tool_use_id);                |
|         abortController.abort();                                            |
|         break outer;                                                        |
|       } } } }                                                               |
+-----------------------------------------------------------------------------+
                                   | throw
                                   v
+- 2. TYPE -------------------------------------------------------------------+
| class GuardBypassError extends Error { toolName; toolUseId; version }       |
+-----------------------------------------------------------------------------+
                                   | propagates through handlers' catch blocks
                                   v
+- 3. RECORD -----------------------------------------------------------------+
| withErrorHandling: skip commitAll . setError(+bypass fields) . commitPaths  |
+-----------------------------------------------------------------------------+
                                   | read back later
                                   v
+- 4. GATE -------------------------------------------------------------------+
| drive.ts error branch: version differs AND tree clean, else refuse          |
+-----------------------------------------------------------------------------+
```

### 10.2 Aborting

`abortController` is passed as an SDK option and `abort()` is called on the first unseen
`tool_result`, then the `for await` breaks. **Not `query.interrupt()`**, which is a graceful
turn-boundary stop — the point is to not let the session take another step.

An abort we initiated must be distinguishable from a user `SIGINT`: an `aborting` flag is set
immediately before `abort()` and checked in the `catch`. Without it, a `Ctrl-C` during a healthy
session would surface as a guard bypass, error the task and block its retry — the most expensive
possible false positive.

### 10.3 Why a class and not a message convention

The handlers sit between `runAndStream` and `drive`, and their failures funnel through
`withErrorHandling` (`safe-wrapper.ts`) into `setError` with a formatted string. `qa.ts` and
`execute.ts` have their own `catch` blocks that rethrow what they do not recognise, so the error
reaches the wrapper intact — but only an `instanceof` check can survive that path. A message
convention would require every intermediate `catch` to preserve a substring, which is the same
defect class as a gate that greps an error message.

`setError`'s second caller, `review-runner.ts:88` ("no spec after the forced re-run"), is not on a
session-failure path and is untouched.

### 10.4 What `withErrorHandling` does differently

| Step | Ordinary failure (today, unchanged) | `GuardBypassError` |
|---|---|---|
| Commit partial work | `commitAll(..., "partial work (error)")` — `safe-wrapper.ts:21` | **skipped.** The unguarded call's output must not be committed (F5.2) |
| Roll back | n/a | **nothing.** Partial work stays in the tree, uncommitted and visible in `git status` (F5.3). Silently reverting would destroy the only evidence of the bypass |
| `setError` | `setError(planPath, stage, message)` | `setError(planPath, stage, message, { guard_bypass: true, guard_bypass_version })` |
| Commit state | swept up by the next lap | `commitPaths(git, ["<plan>/state.yml"], "vibe-racer: guard bypass recorded for #N")` |
| Rethrow | yes | yes |

**Why `state.yml` is committed alone.** Without it the marker exists only as an uncommitted change
in the very tree the retry gate asks the user to clean: a `git stash -u` or `git reset --hard`
would erase it, the task would fall back to its previous stage, and the next `drive` would run the
lap again on the same version — the gate defeated by following its own instruction. With it,
"discard what the session left" is a safe way to reach a clean tree. If the commit itself fails,
the wrapper says so and names the file; the marker is still on disk and the gate holds for as long
as it is.

`commitPaths` is a **partial commit** (`git commit -m <msg> -- <path>`), which commits that path's
working-tree content and ignores the index entirely — so nothing the session wrote can be swept in
even if something was staged. It runs the same `scanFiles` secret scan over its own path set, for
parity with `commitAll`; a `SecretDetectedError` on `state.yml` is reported, never buried, and
falls back to the "marker is on disk" path.

### 10.5 The false-abort probe and the planned fork

C3.3 and F5 flag three cases that could make the heartbeat abort a healthy session. The probe is a
**blocking prerequisite** for shipping the abort, and this design pre-commits the narrowing lever
for each so the fix is a one-line rule change rather than a redesign:

| Case | Narrowing lever already available | Status |
|---|---|---|
| A tool removed from context by `tools` narrowing | the hook *is* invoked for such a call if the model emits it at all; if the SDK synthesises an error result instead, `isSynthetic` on `SDKUserMessage` marks it | probe |
| A subagent's calls | `parent_tool_use_id !== null` on the message, and `agent_id` on the hook input, both identify subagent traffic. `Task` is denied at every stage (F2), so this should be unreachable — but "should be unreachable" is what this whole task is about | probe |
| `server_tool_use` | server-side tool results arrive inside assistant content, not as a user `tool_result` block, so the heartbeat should never see them | probe |

If any case produces a `tool_result` with no `PreToolUse` invocation **and** none of the levers
above excludes it, the heartbeat ships **warning-only**: print, audit the bypass entry, do not
abort, do not error the task. The abort becomes its own task.

The fork is structural, not a judgement call made later: `createGuardRun` and the detect loop are
identical in both outcomes, and the difference is a single `HEARTBEAT_ABORTS` boolean constant plus
the `withErrorHandling` branch being unreachable. **The guard itself — the part acceptance depends
on — ships either way.**

---

## 11. SDK integration patterns

*All type references read from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` at 0.3.270.*

### 11.1 The hook contract, in the SDK's real shapes

```ts
type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookJSONOutput>;

interface HookCallbackMatcher { matcher?: string; hooks: HookCallback[]; timeout?: number }

type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: unknown;        // <- unknown, not Record<string, unknown>
  tool_use_id: string;
};

type PreToolUseHookSpecificOutput = {
  hookEventName: "PreToolUse";
  permissionDecision?: "allow" | "deny" | "ask" | "defer";
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
};

hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
```

Three things the tier-2 "real input shape" test must therefore do, because getting any of them
wrong produces a hook that type-checks and never denies:

1. Dispatch on `input.hook_event_name === "PreToolUse"` and read `tool_name` / `tool_input` —
   **not** the `(toolName, input)` positional shape `canUseTool` used. `tool_input` is typed
   `unknown`, so the cast to `Record<string, unknown>` happens once, at the hook boundary, with a
   `?? {}` for a null input.
2. Return the denial inside `hookSpecificOutput` with `hookEventName: "PreToolUse"` — a top-level
   `{ behavior: "deny" }`, the `canUseTool` shape, is silently ignored by the hook path.
3. Register as `[{ hooks: [cb] }]` — an array of matchers, each holding an array of callbacks.
   Passing the callback directly, or wrapping it one level too few or too many, type-errors in some
   shapes and silently no-ops in others.

`BaseHookInput` also carries `agent_id` and `agent_type`, which are the subagent discriminators
§10.5 relies on.

### 11.2 Narrowing with `tools`

```ts
tools?: string[] | { type: "preset"; preset: "claude_code" };
```

The SDK documents this as "the base set of available built-in tools" — **built-ins only**. MCP
tools, including claude.ai connectors (present even with `settingSources: []`), are not covered and
are stopped by the hook's default-deny instead. Whether `strictMcpConfig: true` also keeps them out
of *context* is unverified; the live tier probes it (E6), and it is a context/UX improvement only.

`disallowedTools` is deliberately **not** used: it would require a hand-kept `BUILTIN_TOOLS`
complement, and a probe session had roughly thirty tools in context, so a hand-kept complement is
permanently behind (C2). An allowlist cannot fall behind.

**No test asserts security on narrowing** (F2.4). Acceptance rests on F2.1 — the hook's
default-deny — alone.

### 11.3 The heartbeat's read of the stream

A tool result reaches the caller as an `SDKUserMessage`:

```ts
type SDKUserMessage = {
  type: "user";
  message: MessageParam;          // content: string | ContentBlockParam[]
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
};
```

So `toolResultBlocks(message)` must: guard `typeof message.message.content !== "string"`, filter
`block.type === "tool_result"`, and read `block.tool_use_id`. `parent_tool_use_id` and
`isSynthetic` are read for §10.5's levers. This is read-only inspection of a message the loop
already iterates — no extra SDK surface, no polling.

### 11.4 The skill-discovery probe session (E15)

`runAndStream` already starts a second `query` with `maxTurns: 0` to call `supportedCommands()`
(`session.ts:60`). It runs no tools and is not a guarded session. Two things this design does about
it:

- It is started **after** pre-flight, so a refused `drive` never reaches it (F3.5).
- It gains `tools: []` — disable all built-ins. It needs none, and "every session vibe-racer starts
  either is guarded or can call no tool at all" is a sentence with no exceptions, which is cheaper
  to document than a carve-out. `docs/security.md` names it so it is not mistaken for a gap.

### 11.5 The warning canary (F1.5, C3.2)

The `process.on("warning")` listener for `CLAUDE_SDK_*` stays, re-described in code and docs as
**a regression canary, not a detection layer**: with `canUseTool` gone the SDK cannot emit
`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` — it is the only `CLAUDE_SDK_*` code that exists and it is gated
on `canUseTool` being passed. It fires if someone reintroduces the shadowed wiring. It lives in the
**live tier only**, as a vitest setup file: in tiers 1–2 `query` is mocked and the SDK code that
emits the warning never runs, so a listener there protects nothing (C4). The tiers-1–2 equivalent is
`assertHookInstalled`'s `canUseTool`-is-absent assertion.

---

## 12. State management design

### 12.1 Ownership and lifetime

| State | Lives in | Lifetime | Why there |
|---|---|---|---|
| Rule constants | `guard.ts` module scope | process | immutable |
| The lap's tool list | one frozen array from `toolsForSession` | one session | threaded three ways (§5.3) |
| Seen `tool_use_id`s | `GuardRun` closure | one session | two sessions share `cleanup_ready` |
| Denial counts + suppression | `GuardRun` closure | one session | the tally is user-visible — sharing it is a correctness bug (Q2) |
| `aborting` flag | `runAndStream` local | one session | distinguishes our abort from `SIGINT` |
| Denial records | `.vibe-racer/audit.log` | until rotation at 1 MB | local evidence, never committed |
| Bypass marker | `state.yml` | until a successful retry | pipeline-owned; `--retry` gates on it |

No module-level mutable state in any guard module. That is the one rule that makes this table
readable rather than a set of coincidences.

### 12.2 `state.yml` additions

```yaml
guard_bypass: true              # boolean — the marker --retry gates on
guard_bypass_version: "0.3.1"   # the vibe-racer version that hit it (F5.5)
```

```ts
// src/state/schema.ts, alongside error_stage / error_message
guard_bypass: z.boolean().optional(),
guard_bypass_version: z.string().optional(),
```

Separate fields, not folded into `error_message`, following the precedent the operator-pause fields
already set: *"`pitwall` and `drive` must tell a pause from a failure without string-inspecting a
stage name."* A gate that greps an error message is an invariant held by string inspection — the
defect class this repository has already paid for once.

`setError` grows an **optional fourth parameter** for extra fields rather than a new function, so
its salvage path — the one that must never throw — keeps a single implementation. The fields go
into the salvage write too: an abort on a task with a corrupt `state.yml` must still record that it
was a bypass, because the gate is the only thing standing between the user and a second paid
bypass.

`state.yml` stays pipeline-owned at every stage (guard Rule 0, unchanged). The new fields are
written only by `setError` and cleared only by `updateStage`.

### 12.3 The retry gate

Lives in `drive.ts` where the `error` branch already resolves `error_stage` (`drive.ts:214`),
evaluated **before** `updateStage`:

```
task.stage === "error"
  |- state.guard_bypass !== true --> today's behaviour, unchanged (E13)
  +- state.guard_bypass === true
        |- installed version === guard_bypass_version  --> FAIL: "the version that bypassed
        |                                                        the guard is still installed"
        |- !(await git.status()).isClean()             --> FAIL: "commit or discard what the
        |                                                        aborted session left"
        +- both hold --> updateStage(target) clears guard_bypass + guard_bypass_version,
                         then dispatch as usual
```

**Both conditions are reported together** — unlike pre-flight's first-failure-only — because they
are two halves of one instruction to the user, not a prioritised list of independent faults. The
message also names the audit log and the dirty working tree as the two artefacts to attach to a
report, and says the block is deliberate.

Neither condition clears the marker; **a successful retry does**, as part of the `updateStage` that
leaves `error`, so a task that bypasses twice does not inherit a stale marker.

The installed version comes from the `package.json` version `src/cli/index.ts:9` already imports.
A checkout run through `npm link` therefore only passes the version condition after a version bump
— intended, since "the mechanism was replaced" has to be something someone asserted deliberately —
and the refusal message says so for the linked case.

**If no fixed version exists yet, the task waits.** That is the real cost of this design, stated
rather than softened (E11).

### 12.4 What this task does not touch

`STAGE_ORDER`, `NON_LINEAR_STAGES`, the `need_operator` detour, `STAGE_QUESTIONS_FILE`, the
Execution Status table contract, `markdown-scan.ts` and both its readers. No stage is added and no
transition changes. The only state-machine-adjacent change is a new *reason* for reaching the
existing `error` stage and a condition on leaving it.

---

## 13. Data flow

### 13.1 A denied call, end to end

```
model: tool_use { name: "Write", input: { file_path: "../../etc/hosts" }, id: "toolu_01A" }
  |
  v  SDK invokes PreToolUse hook (no matcher)
GuardRun.hook(input, "toolu_01A")
  |  seen.add("toolu_01A")                                  <- before deciding (§6.3)
  v
decideToolCall(options)("Write", { file_path: "../../etc/hosts" })
  |  rule 1 bash-review-stage  -> n/a
  |  rule 2 membership         -> "Write" in list -> pass
  |  rule 3 state-yml          -> basename not state.yml -> pass
  |  rule 4 sensitive-path     -> not under ~/.ssh ... -> pass
  |  rule 5 path-jail          -> NOT within cwd|tmp -> DENY
  v
{ behavior: "deny", tool: "Write", input: "../../etc/hosts",
  reason: "path outside project directory", rule: "path-jail" }
  |
  |--> formatDenial -> "Denied: Write ../../etc/hosts — path outside project directory"
  |--> printed.has(key)? no -> log.warn(msg)                <- F4, inline, first of pair
  |--> counts[key] += 1                                     <- F4.4, every denial
  |--> appendAuditEntry(cwd, { kind:"denial", ts, stage, tool, input, reason, rule }) -> true
  +--> return { hookSpecificOutput: { hookEventName:"PreToolUse",
                                      permissionDecision:"deny",
                                      permissionDecisionReason: msg } }
  v
tool does NOT run; the model sees the reason and changes course
  v
... session ends ...
  v
run.summary() -> { total: 1, groups: [{tool:"Write", rule:"path-jail", reason:"...", count:1}],
                   logPath: "/repo/.vibe-racer/audit.log" }
  v  printed in a `finally`, on success and on failure (F4.3)
1 denial . Write path-jail x1 . see /repo/.vibe-racer/audit.log    <- path only, never entries (F4.2)
```

### 13.2 An out-of-list call

```
model: tool_use { name: "WebFetch", ... }    (only reachable if narrowing left it in context,
  |                                           or via settings re-grant, or an MCP tool)
  v  hook -> rule 2 -> { deny, rule: "tool-not-in-list",
                         reason: "not available at this stage (ai_qa)" }
  v
"Denied: WebFetch 'https://...' — not available at this stage (ai_qa)"
```

F2.6's legibility requirement is met by the reason naming both the tool (via `formatDenial`'s first
field) and the stage — enough to diagnose a skill that asked for it (E7) without opening the audit
log.

### 13.3 Pre-flight refusal

```
vibe-racer drive
  |- prerequisites . config . discover . advance ticks . select task
  |- preflight(cwd)
  |    1 SDK 0.3.271 != 0.3.270 -> { ok:false,
  |        what: "the tool guard has not been verified against the installed SDK
  |               (found 0.3.271, verified 0.3.270)",
  |        fix:  "reinstall vibe-racer, or remove the overrides entry for
  |               @anthropic-ai/claude-agent-sdk" }
  +- render -> exit != 0
       - stage unchanged (F3.3)      - no branch checkout (F3.5)
       - no commit, no state write   - nothing spent (F3.2)
```

### 13.4 The bypass path

```
tool_result { tool_use_id: "toolu_09Z" } arrives -- run.sawToolUse("toolu_09Z") === false
  v
aborting = true . run.recordBypass("Bash","toolu_09Z") . abortController.abort() . break
  v                                    +--> audit { kind:"bypass", ts, stage, tool,
  |                                                 tool_use_id, version }
throw new GuardBypassError({ toolName, toolUseId, version })
  v  handler catch blocks rethrow unrecognised errors
withErrorHandling
  |- SKIP commitAll                                                        (F5.2)
  |- setError(planPath, stage, msg, { guard_bypass:true, guard_bypass_version:version })
  |- commitPaths(git, ["<plan>/state.yml"], "vibe-racer: guard bypass recorded for #N")
  +- rethrow
  v
working tree: the session's partial work, uncommitted, visible in `git status`   (F5.3)
  v
next `vibe-racer drive --retry` -> §12.3 gate
```

---

## 14. Banners, notices and CLI surfaces

| Surface | Today | After | Requirement |
|---|---|---|---|
| `runAndStream` guard banner | `log.guard(formatGuardSummary(stage, allowedTools ?? [], ...))` printed whenever `stage` is set (`session.ts:39`) | printed **after** `assertHookInstalled` passes on the real options object, with `run.tools` — the array the hook holds | F7.1, F7.2 |
| `init` | `Security: canUseTool path-jail enabled (project root only)` (`init.ts:82`) | names the mechanism actually used and does not say `canUseTool`; e.g. `Security: tool guard enforced on every drive session (PreToolUse hook)` | F7.3 |
| `formatGuardSummary` jail note | mirrors Rule 4a | unchanged — still mirrors rule 7's condition exactly | F7.4 |
| `radio` | silent | one `log.dim` line before the interactive session opens: this is your own `claude` CLI, the guard does not apply, nothing here is restricted. **No prompt, no confirmation** | F8.1, F8.2 |
| `drive` end-of-lap | nothing | the `run.summary()` block, or nothing at all when it returns `null` | F4.1, F4.3 |

The banner's dependency on `assertHookInstalled` is the whole of F7.1 in one line of control flow:
the print is downstream of the assertion, so there is no path on which it describes enforcement
that is not installed.

---

## 15. Configuration and environment

### 15.1 `package.json`

```diff
-    "@anthropic-ai/claude-agent-sdk": "^0.3.270",
+    "@anthropic-ai/claude-agent-sdk": "0.3.270",
```

```diff
     "test": "vitest run",
+    "test:live": "VIBE_RACER_LIVE=1 vitest run --config vitest.live.config.ts",
```

The pin is stronger than it looks: the SDK pins its per-platform binary packages to the same exact
version, so this also fixes the executable that honours the hook (C3.1). The lockfile is
regenerated in the same commit.

### 15.2 `.vibe-racer.yml`

**No new keys.** Specifically no `tools:` override (F2.5) — a per-lap list override is a real
request the MCP denial will generate, and it is a follow-up with its own questions, not a switch
added in passing. `skills:` and `max_turns:` keep their current meaning; a lap with a resolved skill
still gets `Skill` in its list, now via `toolsForSession` rather than the splice at `session.ts:89`.

### 15.3 `.gitignore`, in two places

| File | Change |
|---|---|
| `<user project>/.vibe-racer/.gitignore` | **created by vibe-racer**, containing `*`, whenever the directory is created — by `preflight` or by `appendAuditEntry`. Never overwritten if present. No edit to the user's own `.gitignore`; no dependence on `init` having run (F6.1) |
| this repository's `.gitignore` | `.viberacer/` -> `.vibe-racer/`; the stale `.viberacer-secrets` line checked against what `src/git/secrets.ts` actually reads, and corrected or deleted (F6.5) |

### 15.4 Environment

No new environment variables for runtime behaviour. There is **no `--unguarded` flag and no env
escape** (F3.1) — a negative test asserts no such flag is registered on the `drive` command.
`VIBE_RACER_LIVE` gates the tier-3 suite only and has no effect on the shipped CLI.

---

## 16. Testing strategy

### 16.1 Tier 1 — rules, via `decideToolCall` directly

Runs in `npm run test`. No SDK, no filesystem writes, no log output — which is exactly what the
decide-only seam buys. `tests/claude/guard.test.ts` is retargeted from `createToolGuard` onto
`decideToolCall`; the assertions change shape in one mechanical way:

| Today | After |
|---|---|
| `expect(result.message).toContain("sensitive path")` | `expect(d.rule).toBe("sensitive-path")` |

Message text is asserted **once per rule**, in a dedicated byte-identity table test, rather than in
every case — brittle exactly where F1.3 promises the messages are unchanged. Everything else
asserts `rule`.

New tier-1 coverage:

- every `GuardRuleId` reachable, and the two reused ids (§4.3) asserted from both routes;
- rule **order** — `Bash` at a review stage yields `bash-review-stage`, never `tool-not-in-list`
  (the single most invertible decision in §4.2);
- `tools.ts` — every agent stage has an entry; `Skill` present iff `withSkill`; `FASTEN_TOOLS`
  denies `Write`/`Edit` as `tool-not-in-list`; returned arrays frozen;
- `audit.ts` — rotation at the cap, `.1` replaced, `false` on an unwritable directory, `kind` first
  in the serialised line, `.vibe-racer/.gitignore` created with `*` and never overwritten;
- `GuardRun` — suppression on `(tool, rule, reason)`, `total` counting suppressed denials,
  `summary()` `null` at zero, idempotent across two calls, two runs in one process not sharing
  state.

### 16.2 Tier 2 — wiring, with `query` mocked

Runs in `npm run test`. This tier is the one that would have caught the defect, so each assertion is
written as the inverse of a way the bug could return:

| Assertion | The bug it forbids |
|---|---|
| `options.hooks.PreToolUse` is a non-empty array of matchers with a non-empty `hooks` array | the hook is never registered |
| `"canUseTool" in options === false` | **the wiring test fails if the guard is passed only as `canUseTool`** (F1.4, §17 B) |
| the captured hook, invoked with a real `PreToolUseHookInput` literal, returns `hookSpecificOutput.permissionDecision === "deny"` | the hook reads `(toolName, input)` positionally, or returns the `canUseTool` shape |
| a tool outside the lap's list is denied by that same captured hook | F2.1 regressed to narrowing-only |
| `Object.is(options.tools, run.tools)` | the banner and the hook computing lists separately (§5.3) |
| a denial written through the hook appears in `.vibe-racer/audit.log` in a temp cwd | issue #7's own suggestion; the audit path drifting from the refusal's path |
| the four pre-flight triggers each refuse, first failure only, 3 before 4 | a refusal that reports the wrong fix |
| no refusal message contains `npm install @anthropic-ai/claude-agent-sdk` | the helpful-but-wrong fix being added back |
| `VERIFIED_SDK_VERSION` equals the `package.json` pin, with no caret | the constant and the pin drifting |
| the `drive` command registers no `--unguarded`-like flag | F3.1 eroding |
| a synthetic stream whose `tool_result` id the run never saw throws `GuardBypassError`; one whose id it saw does not | the heartbeat inverted, or firing on denied calls |
| `withErrorHandling` on a `GuardBypassError` calls `setError` with the bypass fields and **does not** call `commitAll` | F5.2 regressing to a partial-work commit |
| the retry gate refuses on same-version, refuses on dirty tree, names which is missing, and clears the marker on success | the gate silently passing |

### 16.3 Tier 3 — live, opt-in (`npm run test:live`)

Real paid sessions in a scratch directory. Never in the default `npm run test`, never required by
CI. If it cannot run unpaid in CI it becomes a documented manual release step (objective, "What"
bullet 4) — the probe list below is that document either way.

| ID | Probe | Settles |
|---|---|---|
| L1 | bypass + `PreToolUse` hook denying everything; ask for a `Write` | the hook fires and the write does not happen — the premise of the whole task |
| L2 | `tools`-only (no `allowedTools`), review list; ask for a search | §5.4 — search still routes through `Grep`/`Glob` |
| L3 | `settingSources: ["project","user"]` + `permissions.allow: ["Bash"]` at a review stage | E5 — a re-granted out-of-list tool is still denied |
| L4 | `strictMcpConfig: true` with connectors installed | E6 — whether MCP tools leave *context*; the hook denies them either way |
| L5 | a tool removed from context by `tools`; a subagent call; a `server_tool_use` | **F5's blocking prerequisite** — the three false-abort cases (§10.5) |
| L6 | a session with `canUseTool` reintroduced | the `process.on("warning")` canary actually fires (C3.2); lives only in this tier |
| L7 | `fasten` against a scratch repo | `01_product.md` §18.2's manual check, written down where a releaser reads it (§19.3) |

`vitest.live.config.ts` sets `include: ["tests/live/**"]`, a long timeout, and a setup file
installing the warning listener. Every live test refuses to run without `VIBE_RACER_LIVE=1`, so a
stray `vitest` invocation cannot spend money.

### 16.4 The dry run (F10), for completeness

Seven real paid laps against a throwaway task, owned by the **operator** as two gate rows. Not a
test tier; its output is the `.vibe-racer/audit.log` and a per-lap completed/not-completed line that
a following agent milestone classifies into F10's three outcomes and records in `05_qa.md`. Its pass
bar: every lap completed its own document once under the live guard, every denial classified, none
unexplained.

### 16.5 The regression that does not exist yet

`tests/claude/session.test.ts` today mocks `query`, pulls `canUseTool` out of the captured options
and invokes it by hand — proving the callback is *passed*, not that anything *calls* it. That file
is rewritten, not extended: a test that asserts a dead parameter is worse than no test, because it
reads as coverage. The `canUseTool`-is-absent assertion replaces it, and is the one assertion in
this task that makes the original defect impossible to reintroduce silently.

---

## 17. Build and distribution

- **`tsup` config unchanged.** One ESM entry, `src/index.ts`, target node20. The five new modules
  are internal and reached through the existing graph.
- **No new entry points, no new bin.** `test:live` is a dev script and `tests/` is not in `files`.
- **`files` unchanged** — `dist`, `README.md`, `LICENSE`, `CHANGELOG.md`.
- **The pin changes resolution, not packaging.** `npm install -g vibe-racer` now installs SDK
  0.3.270 exactly, including its exact per-platform binary — which is the executable that honours
  the hook, so the pin is doing security work, not hygiene.
- **Build order gate.** `npm run build && npm run typecheck && npm run lint && npm run test` pass at
  every milestone (objective constraint). The `tools.ts` collapse (§5.5) is the one milestone where
  `typecheck` is the real test: deleting seven literals and threading one value is a change the
  compiler can verify completely.
- **Version number is the operator's call** after `done`. `main` already carries #5's unreleased
  work, so the release containing this fix is not a patch of 0.3.0 unless cut from a `v0.3.0` hotfix
  branch. Merge, version, publish and `npm deprecate vibe-racer@0.3.0` are **never rows in the
  Execution Status table**.

---

## 18. Dependency summary

### 18.1 Runtime — no additions

| Package | Version | Change | Used here for |
|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | `^0.3.270` -> **`0.3.270`** | **pinned exactly** | hooks, `tools`, `abortController`, types |
| `simple-git` | `^3.32.3` | none | `ls-files --error-unmatch` (check 3), `status().isClean()` (gate), `commitPaths` |
| `zod` | `^4.3.6` | none | the two new `state.yml` fields |
| `chalk`, `commander`, `yaml`, `@inquirer/prompts` | — | none | — |
| `node:module` (`createRequire`) | built-in | **new use** | resolving the installed SDK's `package.json` (check 1) |
| `node:fs` (`openSync`, `renameSync`) | built-in | **new use** | writability probe, rotation |

**No new runtime dependencies**, per the objective's constraints. In particular no `semver`:
equality on an exact pin is a string compare.

### 18.2 Dev — one addition

`vitest.live.config.ts`, a second config file for the opt-in tier. No new dev package.

---

## 19. Gaps this design surfaces

Three things neither Q1–Q6 nor F1–F10 name, which become live the moment narrowing and default-deny
are both on.

### 19.1 Tools no list names, that laps plausibly already use

F2's baseline table decides `Skill`, `Task`, `WebFetch`, `WebSearch`, MCP, and the scheduling/
messaging/remote/worktree families, and leaves `TaskOutput` / `TaskStop` / `ToolSearch` to the dry
run. It does not name three more that are in context **today** (because `allowedTools` never
filtered anything) and are in no lap's list:

| Tool | Why it matters | Q8's principle says |
|---|---|---|
| `TodoWrite` | agents use it for multi-step work; plausibly called on most laps | no reach of its own -> candidate |
| `BashOutput` | reading a backgrounded `Bash` call. The execute and QA laps list `Bash` | no reach beyond `Bash`, already allowed -> candidate |
| `KillShell` | stopping one | same |

Left undecided, these surface as `tool-not-in-list` denials on the dry run — possibly on every lap,
costing a re-run of all seven paid laps. They are exactly E8's case ("adding one where its parent
tool is already allowed is the only list change F10's third outcome may make"), so **the design
position is: pre-seed them as named candidates** — `BashOutput` and `KillShell` wherever `Bash` is
listed, `TodoWrite` on every lap — in the same row of F2's table as `TaskOutput`/`TaskStop`/
`ToolSearch`, with the dry run confirming rather than discovering. Discovering by paid session what
reading the tool list would have told us is the expensive way round. Carried to plan question Q2.

### 19.2 `Bash` in background mode

If `BashOutput` is not listed, a backgrounded `Bash` call produces output no later call can read,
and the agent's only recovery is to retry — which is the eight-retries-one-screenful case F4's
collapsing exists for, except the retries are not denied, they are *useless*. Narrowing is not the
cause; the cause is a tool family split across the allow boundary. Resolved by 19.1.

### 19.3 The dry run cannot see `fasten`

`01_product.md` §18.2 gives `fasten` a read-only profile and says verification is "one manual check
in the release steps, not a dry-run lap". That check needs to exist as text somewhere a releaser
reads. **Design position:** it joins the tier-3 probe list as L7 (§16.3), in the same document as
the other probes, rather than living only in a release checklist that no test touches.

---

## 20. Deviations from the Q&A, with rationale

Two, both small, both flagged for the operator to overturn by striking the paragraph.

### 20.1 `buildSessionOptions` lives in a new `session-options.ts`, not in `session.ts`

Q3 says "hoist session options construction into an exported `buildSessionOptions(...)` in
`session.ts`". The function and its three consumers are exactly as Q3 specifies; only the file
changes.

**Why.** Pre-flight's entire job is to run *before* any session machinery is touched. If
`guard-preflight.ts` imports `session.ts`, it imports the module that holds `query`, the streaming
loop and the skill probe — and because §8.3 already has `runAndStream` re-asserting on the real
options object, the import relationship is live in both directions in intent if not yet in code. A
separate leaf module makes the direction unviolatable: `session-options.ts` imports `tools.ts` and
`guard-hook.ts`, and nothing imports it except `session.ts` and `guard-preflight.ts`.

**If struck**, `buildSessionOptions` goes in `session.ts` and the invariant "`session.ts` must never
import `guard-preflight.ts`" becomes a comment rather than a property of the graph.

### 20.2 `allowedTools` is dropped rather than kept equal to `tools`

C2 and F2.2 say to narrow with `tools`. Neither says what happens to `allowedTools`, which is
currently the only tool-related option passed. §5.4 drops it: under `bypassPermissions` it has no
effect on what the model may call, and a second list that must agree with the first is a drift
surface with no benefit. L2 in the live tier confirms search still works without it.

**If struck**, `allowedTools` is passed with the same array as `tools` and the tier-2 identity
assertion (§5.3) covers three consumers instead of two.

---

## 21. Traceability

| Design section | Q&A | Product |
|---|---|---|
| §4 `guard.ts` decide-only, `GuardDecision`, `GuardRuleId`, rule order | **Q1**, Q5 (ordering) | F1.1–F1.3, F2.1, F2.6 |
| §4.4 suppression-key wrinkle | Q2 (corrected) | F4 |
| §5 `tools.ts`, one value three ways, `allowedTools` dropped | **Q5**, C2 | F2.1–F2.4, F7.2 |
| §6 `GuardRun`, suppression, summary, audit-inside-hook | **Q2** | F1.1, F1.2, F4.1–F4.4, F5.4 |
| §7 `audit.ts` union, rotation, self-ignore, boolean return | **Q6** | F6.1, F6.3, F6.4, F4.2, F5.4 |
| §8 `session-options.ts`, `assertHookInstalled` | **Q3** (+§20.1) | F1.4, F3 check 2, F7.1 |
| §9 `preflight`, four checks, renderer, two call sites | **Q3**, C3.1 | F3.1–F3.6, F6.2, §18.2 |
| §10 abort, `GuardBypassError`, wrapper branch, planned fork | **Q4**, C3.3 | F5.1–F5.5, E10, E11 |
| §11 SDK shapes, `tools` semantics, stream read, probe session, canary | C1, C2, C3.2 | F1.1, F1.5, F2.2, E6, E15 |
| §12 state ownership, `state.yml` fields, retry gate | **Q4** | F5.1, F5.5, E12, E13, E16 |
| §13 data flows | Q1, Q2, Q3, Q4 | F4, F3, F5 |
| §14 banners and notices | Q5 (list identity) | F7.1–F7.4, F8.1, F8.2 |
| §15 pin, no new config keys, two `.gitignore` edits | C3.1, **Q6** | F2.5, F6.1, F6.5, §14.2–14.4 |
| §16 three tiers + dry run, the rewritten session test | **C4**, Q1 | §17 B, F10 |
| §17 build, pin-as-security, operator's release | — | §14.2, "Release" |
| §18 no new runtime deps | — | §14.4 |
| §19 unnamed tool families, `fasten` manual check | extends Q8 / E8 | F2 last row, §18.2 |
| §20 two deviations | Q3, C2 | — |
