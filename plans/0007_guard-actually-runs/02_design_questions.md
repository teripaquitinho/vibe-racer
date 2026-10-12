# Design Questions for #7: guard-actually-runs

> **Role**: Senior Software Architect
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-10-12

---

The product spec (`01_product.md`) settles *what* the guard does. C1–C4 in the objective already
carry transport (a `PreToolUse` hook, `canUseTool` dropped), narrowing (the SDK `tools` option), the
SDK pin and the three test tiers — those are **inputs**, not questions to re-open.

What is genuinely undecided is **structure**: the guard is currently one 400-line closure that
decides, logs, audits and returns an SDK-shaped result in the same function, and the task now needs
that same body to serve a hook, a pre-flight check, a denial accumulator, a heartbeat and three test
tiers. These six questions fix the boundaries those five consumers share.

---

## Module structure and the decision contract

### Q1: How does `guard.ts` split, and what exactly is a `GuardDecision`?

C1 says "split the rule body into a transport-neutral `decideToolCall(options)(toolName, input) →
GuardDecision`, wrap it in `createGuardHook`". But `createToolGuard`'s `deny()` helper does four
things at once — formats the message, calls `log.warn`, appends the audit entry, and returns an
SDK `PermissionResult`. If `decideToolCall` keeps all four, it is not transport-neutral and it
cannot be called from a unit test without writing to a log file. Where does the seam go, and what
crosses it?

**Answer:**
Three modules, with the seam at **decide-only**. `decideToolCall` performs **no I/O at all** — no
`log.warn`, no audit append. It returns data; the caller decides what to do with it.

| Module | Exports | Imports |
|---|---|---|
| `src/claude/guard.ts` | `decideToolCall(options) → (toolName, input) => GuardDecision`; all rule constants (`BASH_BLOCKLIST`, `PLAN_JAILED_STAGES`, `SENSITIVE_PATHS`, `NETWORK_SIGNATURES`, …); `formatGuardSummary`; `GuardOptions` | `node:fs`, `node:path`, `node:os` only — **no SDK types, no logger, no audit** |
| `src/claude/guard-hook.ts` | `createGuardRun(options) → GuardRun` (Q2) | `guard.ts`, `audit.ts`, `logger.ts`, SDK types |
| `src/claude/guard-preflight.ts` | `preflight(cwd) → PreflightResult` (Q3) | `guard.ts` for nothing but the shape; `audit.ts`, `package.json` version |

`GuardDecision` is a discriminated union holding everything a caller needs to log, audit and reply,
and nothing SDK-shaped:

```ts
export type GuardDecision =
  | { behavior: "allow" }
  | {
      behavior: "deny";
      tool: string;      // toolName as received
      input: string;     // the existing one-line input summary (raw path, or 'command')
      reason: string;    // the existing reason text, unchanged
      rule: GuardRuleId; // NEW: stable id — "state-yml" | "sensitive-path" | "path-jail" |
                         // "plan-jail" | "dotenv" | "bash-review-stage" | "bash-blocklist" |
                         // "bash-network" | "tool-not-in-list" | "internal-error"
    };
```

`rule` is the one addition to the data model and it earns its place twice: the F4 summary groups by
`(tool, reason)` today, which means two different rules producing similar prose collapse into one
row, and tier-1 tests currently assert on message substrings — brittle exactly where the spec
promises messages are unchanged. Tests assert `rule`; users read `reason`.

**The user-visible message string stays assembled in one place** — a `formatDenial(decision)` in
`guard-hook.ts` producing today's `Denied: <tool> <input> — <reason>` — so the inline line, the
audit entry's fields and the hook's `permissionDecisionReason` cannot drift apart.

`guard.ts` keeping zero SDK imports also means it can be pulled into a prompt or a doc-generation
step later without dragging the SDK in, the same reason `markdown-scan.ts` imports nothing.

---

### Q2: Who owns per-session state — the denial tally, the suppression set, and the seen `tool_use_id`s?

Three features need state that lives exactly as long as one session: F4's duplicate suppression and
end-of-lap counts, and F5's set of `tool_use_id`s the hook has seen. Today `createToolGuard` returns
a bare function and `runAndStream` holds nothing. If each feature grows its own module-level `Map`,
two sessions in one process (the cleanup and decision sessions at `cleanup_ready`, or anything a
test runs twice) will cross-contaminate — and the tally is reported to the user, so that is a
correctness bug, not a tidiness one.

**Answer:**
One factory returning one object per session. `createGuardRun(options)` closes over all per-session
state and exposes a narrow interface; `runAndStream` creates exactly one and holds it for the
session's lifetime. No module-level mutable state anywhere in the guard modules.

```ts
export interface GuardRun {
  /** Register under options.hooks.PreToolUse. Decides, logs, audits, records the id. */
  hook: HookCallback;
  /** F5: has the hook seen this tool_use_id? */
  sawToolUse(id: string): boolean;
  /** F4: null when there were no denials — the caller prints nothing (F4.1). */
  summary(): DenialSummary | null;
  /** F5: audit the bypass as its own entry type. */
  recordBypass(toolName: string, toolUseId: string): void;
}

export interface DenialSummary {
  total: number;
  groups: { tool: string; rule: GuardRuleId; reason: string; count: number }[];
  logPath: string;
}
```

Decisions this pins down:

- **Suppression keys on `(tool, rule)`, not on the formatted message.** Two `curl` denials with
  different URLs are the same denial for display purposes; the audit log keeps both verbatim.
- **`summary()` returning `null`** puts F4.1 ("zero denials prints nothing") in the data model
  rather than in a caller's `if`, so it cannot be forgotten at one of the two `cleanup_ready` call
  sites.
- **The audit append happens inside `hook`, before it returns** — never deferred to the summary.
  A session killed by the heartbeat or by `maxTurns` must still have every denial on disk.
- **`summary()` is pure and idempotent**, so the `finally` that prints it can run on the success and
  error paths without double-counting (F4.3).
- `runAndStream` passes `run.hook` into `options.hooks.PreToolUse` as a single matcher-less entry
  and keeps `run` in a local — **not** on `SessionOptions`, which is a caller-facing input type.

---

## Refusing before anything is spent

### Q3: Where does pre-flight live, who calls it, and how does it read the pinned SDK version?

F3 demands all four checks run "before any session starts and before any repository side effect" —
and `drive` currently checks out a branch at **two** call sites before dispatching — `src/cli/drive.ts:197` on the single-task path and `:33` on the all-tasks path. But the
checks are not all the same shape: #1 and #2 are properties of the install, #3 and #4 of the
project. And check #2 ("the options object vibe-racer is about to pass has `hooks.PreToolUse`") is
a statement about an object that does not exist until `runAndStream` builds it. Where does it
actually run, and how is the pinned version read at runtime without a new dependency?

**Answer:**
**One `preflight(cwd)` called once, from `driveCommand`, immediately after `loadConfig` and
*before* task discovery and `checkoutBranch`.** Not inside `runAndStream`: by then the handler has
been dispatched and `drive` has already checked out a branch, so "nothing was spent" would be true
of tokens but false of the working copy. Not in each handler either — seven call sites for one
invariant is how check #3 ends up missing from one of them.

```ts
export type PreflightResult =
  | { ok: true }
  | { ok: false; what: string; fix: string | null };  // fix === null ⇒ internal defect, report it

export function preflight(cwd: string): PreflightResult
```

`driveCommand` renders the refusal from the result, so the three-part contract (what is wrong ·
nothing was spent · the one fixing command) is assembled in exactly one place and every trigger
inherits it. Returning the **first** failure as a single value — not an array — makes F3's
"report only the first" structural.

Resolving the four checks:

1. **SDK version.** Read `node_modules/@anthropic-ai/claude-agent-sdk/package.json` via
   `createRequire(import.meta.url).resolve(...)` and compare for **equality** against a
   `VERIFIED_SDK_VERSION = "0.3.270"` constant in `guard-preflight.ts`. No `semver` dependency —
   equality is a string compare, which is the whole point of the exact pin (C3.1). Resolving from
   the *SDK's own* `package.json` rather than vibe-racer's `dependencies` is what makes an
   `overrides` entry or a hand-linked SDK visible; reading our own manifest would just echo the pin
   back. A lint-or-test assertion keeps `VERIFIED_SDK_VERSION` equal to the `dependencies` pin, so
   the two cannot drift.
2. **Hook registered.** Hoist session options construction into an exported
   `buildSessionOptions(...)` in `session.ts` and have pre-flight assert `hooks.PreToolUse` is
   non-empty on a representative build, with `canUseTool` absent. This is the same function
   `runAndStream` uses and the same one tier-2 asserts on — one object, three consumers, so a
   refactor that drops the hook is caught by pre-flight *and* by a test.
3. **Tracked audit log.** `git ls-files --error-unmatch .vibe-racer/audit.log` via the existing
   `simple-git` instance in `src/git/`. Exit status is the answer; no parsing. Skip silently when
   `cwd` is not a git repository.
4. **Writable.** `openSync(path, "a")` then `closeSync` — F3.4's "open for append and close, not a
   `stat`, and write no entry". The directory (and its `.gitignore`, per Q6) is created here if
   absent, which is also what makes F6.1 independent of `init` having run.

Checks #3 and #4 run in that order so a log that is both tracked and unwritable reports
`git rm --cached` first — the prerequisite fix.

---

## The heartbeat's mechanics and its error contract

### Q4: How is a session actually aborted, and how does "guard bypass" survive into `state.yml` and back out through `--retry`?

F5 needs three things the current code has no shape for: stopping an in-flight `query` iteration,
an error a handler can distinguish from an ordinary failure, and two conditions `drive --retry`
evaluates later. `setError(planPath, errorStage, message)` takes only strings, and
`stateSchema` has no field for "this was a bypass" — and `state.yml` is pipeline-owned, so the
answer cannot be "put it in the message and grep it".

**Answer:**
Three layers, each with a typed boundary.

**1. Aborting.** Pass an `AbortController` as the SDK's `abortController` option and call `abort()`
on the first unseen `tool_result`, then `break` the `for await`. Not `query.interrupt()`, which is
a graceful turn-boundary stop — the point is to not let the session take another step. Wrap the
iteration so an abort we initiated is distinguishable from a user `SIGINT`: a flag set immediately
before `abort()`, checked in the `catch`.

**2. The error type.** `runAndStream` throws a `GuardBypassError extends Error` carrying
`{ toolName, toolUseId, version }`. It must be a **class, not a message convention**, because six
handlers sit between `runAndStream` and `drive`'s `catch`, and each one currently funnels failures
into `setError` with a formatted string. An `instanceof` check at the single place that calls
`setError` is the only change those handlers need.

**3. The state contract.** Two new optional fields on `stateSchema`, alongside the existing
`error_stage` / `error_message` — and following the precedent the operator-pause fields already set
("deliberately not folded into `error_stage`/`error_message`: `pitwall` and `drive` must tell a
pause from a failure without string-inspecting a stage name"):

```yaml
guard_bypass: true              # boolean — the marker --retry gates on
guard_bypass_version: "0.3.1"   # the vibe-racer version that hit it (F5.5)
```

`setError` grows an optional fourth parameter for extra fields rather than a new function, so its
salvage path — the one that must never throw — keeps a single implementation. The fields go in the
salvage write too; an abort on a task with a corrupt `state.yml` must still record that it was a
bypass.

**4. The retry gate** lives in `drive.ts` where the `error` branch already resolves `error_stage`
(`src/cli/drive.ts:214`). When `guard_bypass` is set, both F5 conditions are evaluated before
`updateStage`:

| Condition | How | Message when missing |
|---|---|---|
| Installed version ≠ `guard_bypass_version` | compare against the version `src/cli/index.ts:9` already imports from `package.json` | "the version that bypassed the guard is still installed" |
| Working tree clean | `simple-git` `status().isClean()` | "commit or discard what the aborted session left" |

Both are reported together here — unlike pre-flight — because they are two halves of one
instruction to the user, not a prioritised list of independent faults. Neither clears
`guard_bypass`; **a successful retry does**, as part of the `updateStage` that leaves `error`, so a
task that bypasses twice does not inherit a stale marker.

---

## The tool list as a security artefact

### Q5: Where does the single source of truth for per-lap tool lists live, now that the list is load-bearing?

`ALLOWED_TOOLS` is declared **six times** across five handler files, with three different values
(`qa.ts:17`, `done.ts:11`, `done.ts:12`, `review-runner.ts:12`, `objective-review.ts:10`,
`execute.ts:61`), plus a seventh inline list in `fasten.ts:114`. Today a drifted copy is cosmetic.
Under F2.1 it is a security boundary, and the hook needs the same list the session was configured
with — so the list has to be reachable from `guard-hook.ts`, which cannot import handlers.

**Answer:**
One new leaf module, `src/claude/tools.ts`, keyed the way `skills.ts` already keys `LAP_BY_STAGE` —
by `Stage`, since `runAndStream` already receives `stage` and the handlers already map 1:1 onto it:

```ts
export const TOOLS_BY_STAGE: Partial<Record<Stage, readonly string[]>> = { /* §F2's table */ };
export const DECISION_TOOLS: readonly string[] = ["Read", "Glob", "Grep", "Write"];
export const FASTEN_TOOLS:   readonly string[] = ["Read", "Glob", "Grep"];
export function toolsForSession(opts): readonly string[]  // applies the Skill allowance
```

Imports nothing but the `Stage` type, so both `session.ts` and `guard-hook.ts` can depend on it with
no cycle.

The one real complication: **`cleanup_ready` has two sessions with different lists** (cleanup gets
`Edit`+`Bash`, the decision session does not) — the same reason `jailToPlanDir` exists, because
"stage alone cannot tell them apart". So the stage map cannot be the only input. `toolsForSession`
takes the stage *and* an optional explicit override, `done.ts` passes `DECISION_TOOLS` for the
second session, and the override lives in the same module as the table it overrides rather than as a
literal at a call site.

Two further decisions:

- **The lap's list is passed once and reused three ways** — the SDK `tools` option (narrowing,
  F2.2), the hook's membership check (F2.1), and the banner (F7.2). `formatGuardSummary` must
  receive the *same* array the hook holds, not a separately-computed one, or F7's "the banner cannot
  lie" is back to being a convention. Threading one value from one source makes it structural.
- **`Skill` is added by `toolsForSession`, not by `session.ts`'s current
  `[...allowedTools, "Skill"]` splice**, so the hook's list and the SDK's list are the same object
  and the existing allowance (`guard.ts`'s early `if (toolName === "Skill") return allow`) can be
  deleted — a hard-coded unconditional allow is exactly the kind of rule that outlives its reason.
  The membership check subsumes it.
- The `tool-not-in-list` denial is checked **first**, before any path or Bash rule, so an out-of-list
  tool gets a reason naming the stage (F2.6) rather than a path-jail reason that happens to fire
  first.

---

## The audit log as evidence

### Q6: Does `audit.ts` keep swallowing its own failures, and where do rotation and the self-ignoring directory live?

`appendAuditEntry` currently ends in `catch {}` with the comment "Audit write failures must not
break the guard", and returns early and silently when the file is at the 1 MB cap. Both were right
for a guard that never fired. Now F3 makes an unwritable log a reason to refuse a lap and F6.3
forbids dropping entries — so a silent failure mid-lap means the pipeline refused to start for a
risk it then tolerates in flight. What replaces it?

**Answer:**
`audit.ts` stays the only writer, gains rotation and directory setup, and **reports failures to its
caller instead of swallowing them** — but still never throws.

```ts
export function ensureAuditDir(cwd: string): void          // mkdir + write .vibe-racer/.gitignore ("*")
export function appendAuditEntry(cwd, entry): boolean      // false ⇒ the entry is not on disk
export function auditLogPath(cwd): string                  // one definition; F4.2's summary uses it
export type AuditEntry = DenialEntry | BypassEntry         // tagged union, `kind` field
```

- **`catch {}` becomes `return false`.** Still no throw — a guard that crashes mid-session because
  it could not write a log is worse than one that denies and reports. But the caller now knows. On
  `false`, `guard-hook.ts` **still denies** the tool call (the deny decision was already made; an
  unrecordable denial is not an allow) and prints one `log.error` naming the path. Promoting that to
  an abort is deliberately **not** done here: it would give a read-only `.vibe-racer/` the power to
  kill a lap mid-flight, which is precisely the case F3 check 4 exists to catch *before* anything is
  spent.
- **Rotation inside `appendAuditEntry`**, checked on the same `statSync` that exists today: at
  ≥ 1 MB, `renameSync(audit.log → audit.log.1)` replacing any previous `.1`, then append to a fresh
  file. Bounded at two files, no entry discarded (F6.3). Rotation failure is a `false` return like
  any other.
- **`ensureAuditDir` is where `.vibe-racer/.gitignore` is written**, called from `preflight` (Q3
  check 4) and idempotently from `appendAuditEntry`'s existing `mkdirSync` path. That covers F6.1's
  "independent of `init` having run" without `init` and the guard each having their own copy of the
  rule. Existing content is never overwritten — if the file is present, leave it.
- **`AuditEntry` becomes a tagged union** with a `kind: "denial" | "bypass"` field (F5.4). Entries
  are one JSON object per line as today; adding a field is backward-compatible for anything reading
  the file, and the discriminator is what lets a future reader (the deferred `vibe-racer audit`,
  Q2's follow-up) tell the two apart without inferring from which fields are present. `rule`
  (Q1) goes in the denial entry too.
- **`auditLogPath` is exported and used by `preflight`, `appendAuditEntry` and `DenialSummary`.**
  Three hand-written `resolve(cwd, ".vibe-racer", "audit.log")` calls is how a refusal ends up
  checking a different file from the one the guard writes.

---

# Complete

- [ ] Ready to advance to Design Review
