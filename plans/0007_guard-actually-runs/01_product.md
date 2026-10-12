# Product Specification for #7: guard-actually-runs

> **Role**: Senior Product Designer
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-10-12
> **Source answers**: `01_product_questions.md` Q1–Q8 (all answered and ticked)
> **Carried decisions**: `00_objective.md` — #6's Q7–Q9, and design inputs C1–C4

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [The guarantee, restated](#2-the-guarantee-restated)
3. [F1 — Enforcement moves to where the SDK consults it](#f1--enforcement-moves-to-where-the-sdk-consults-it)
4. [F2 — Layer 1 becomes a restriction: the tool baseline](#f2--layer-1-becomes-a-restriction-the-tool-baseline)
5. [F3 — Refusing to race: the pre-flight check](#f3--refusing-to-race-the-pre-flight-check)
6. [F4 — Denial surfaces: inline, collapsed, summarised](#f4--denial-surfaces-inline-collapsed-summarised)
7. [F5 — The heartbeat and the bypass incident](#f5--the-heartbeat-and-the-bypass-incident)
8. [F6 — The audit log becomes real](#f6--the-audit-log-becomes-real)
9. [F7 — Banners that cannot lie](#f7--banners-that-cannot-lie)
10. [F8 — The surfaces that stay unguarded](#f8--the-surfaces-that-stay-unguarded)
11. [F9 — Disclosure](#f9--disclosure)
12. [F10 — The pre-release dry run](#f10--the-pre-release-dry-run)
13. [State machine and workflow](#13-state-machine-and-workflow)
14. [Configuration and prerequisites](#14-configuration-and-prerequisites)
15. [Edge cases and error recovery](#15-edge-cases-and-error-recovery)
16. [Scope boundaries](#16-scope-boundaries)
17. [Acceptance criteria](#17-acceptance-criteria)
18. [Open items the operator confirms by ticking](#18-open-items-the-operator-confirms-by-ticking)
19. [Traceability](#19-traceability)

---

## 1. Product Overview

**The problem.** `runAndStream` starts every session with `permissionMode: "bypassPermissions"` and
passes the guard as `canUseTool`. Under SDK 0.3.270 that mode auto-approves every tool call before
the callback is consulted, so none of the rules in `src/claude/guard.ts` have ever run in a real
session. `allowedTools` does not compensate: it is an auto-approve list, not a filter. Meanwhile
`drive` prints `Guard: path-jail to ./<plan> · …`, `init` prints
`Security: canUseTool path-jail enabled`, and five documents describe both layers as enforced.

**The product this task ships.** The same rules, the same messages, the same audit entries — moved
to a `PreToolUse` hook, which is where the SDK actually consults a decision under
`bypassPermissions`. Plus the four user-facing surfaces that only come into existence once the
guard fires: a **refusal** when a lap cannot be guarded, a **denial** a user can read and
understand, a **bypass incident** when enforcement itself misbehaves, and an **audit log** that is
local evidence rather than an accidental commit.

**What a user notices after this ships.**

| Before | After |
|---|---|
| Every tool call ran. Banner said otherwise | Out-of-list, out-of-jail and blocklisted calls are denied, and the banner describes what is installed |
| `.vibe-racer/audit.log` never written | Written on every denial, rotated, git-ignored by its own directory, never committed |
| `drive` always started a session | `drive` refuses before spending anything when it cannot guarantee enforcement |
| MCP tools, `Task`, `WebFetch` silently available to every lap | Denied at every stage; one CHANGELOG line under Changed |
| `radio` silently unguarded | `radio` says so in one line before the session opens |

**Non-goal, stated up front.** This task does not leave `bypassPermissions` (the sessions are
unattended by design), does not change what any rule decides, and does not fix the push gap — that
is #6, which races after this task merges.

---

## 2. The guarantee, restated

After this task, vibe-racer makes exactly one security promise about `drive`, and it is testable:

> Every tool call made by every session `drive` starts is passed to the guard before it executes;
> a call the guard denies does not execute; a denial is recorded in `.vibe-racer/audit.log`; and a
> lap that cannot offer this does not start.

Three honest limits ship **with** the promise, in `docs/security.md`, not as footnotes discovered
later:

- **The heartbeat's bound is one call, not zero.** A call the hook never saw is only detectable
  from its `tool_result`, so the bypassed call has already executed when the session aborts. The
  damage is bounded to one call (Q3, C3.3).
- **Context narrowing is not a security mechanism.** The SDK `tools` option keeps out-of-list
  tools out of context; the hook's default-deny is what makes them unreachable. No test asserts
  security on narrowing (C2).
- **`radio` and `fasten` are not `drive`.** See [F8](#f8--the-surfaces-that-stay-unguarded).

---

## F1 — Enforcement moves to where the SDK consults it

*From: objective "What" bullet 1, C1; confirmed unchanged by this lap.*

### Behaviour

- The rule body becomes a transport-neutral decision function over `(toolName, input)` returning a
  guard decision. Every rule currently in `createToolGuard` — Rule 0 (`state.yml` is
  pipeline-owned), sensitive paths, path containment, dotenv protection, the plan-folder jail at
  review stages, the Bash block at review stages, `BASH_BLOCKLIST`, interpreter-aware network
  detection, and the internal-error deny-by-default — keeps its current condition, its current
  message text, and its current audit entry.
- That decision function is wrapped as a `PreToolUse` hook, registered with **no matcher** so it
  receives every tool call, including tools the lap never listed and tools the project's settings
  re-grant.
- **`canUseTool` is dropped entirely.** Keeping it as belt-and-braces would make every session emit
  `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` — the alarm would become the normal case (C1).

### Product requirements

| ID | Requirement |
|---|---|
| F1.1 | Every tool call of every guarded session reaches the guard, including tools outside the lap's list |
| F1.2 | A denied call does not execute |
| F1.3 | Rule conditions, denial message text and audit entry shape are unchanged by the move |
| F1.4 | `canUseTool` is absent from the options passed to `query` |
| F1.5 | The `process.on("warning")` listener for `CLAUDE_SDK_*` stays, re-described as a canary that fires only if the shadowed wiring is reintroduced (C3.2) |

---

## F2 — Layer 1 becomes a restriction: the tool baseline

*From: Q8; objective "What" bullet 2; C2.*

### The principle (Q8)

> A tool is in a lap's list only if it has no reach of its own beyond what the lap is already
> allowed.

### The baseline, decided now rather than discovered by the dry run

| Tool family | Decision | Rationale (Q8) |
|---|---|---|
| The current per-lap lists | **Unchanged** | They are each lap's documented job |
| `Skill` | **Allowed when the lap resolved skills** — existing allowance | A skill that names an out-of-list tool gets an ordinary denial whose message says the tool is not available at this stage |
| `Task` (subagents) | **Denied at every stage** | Whether the hook sees a subagent's calls is one of C3's three unprobed cases. Until probed, a subagent is a way to act where the guard may not be looking |
| `WebFetch`, `WebSearch` | **Denied at every stage** | `BASH_BLOCKLIST` already denies `curl`/`wget`; the same reach through another tool would make that rule decorative |
| MCP tools, incl. claude.ai connectors | **Denied at every stage** | Unbounded, user-specific reach. **Visible change** — own CHANGELOG line under Changed |
| Scheduling, messaging, remote, worktree tools | **Denied at every stage** | No lap's job involves them |
| `TaskOutput`, `TaskStop`, `ToolSearch` | **Candidates, decided by the dry run** | No reach of their own. The *only* list change F10's third outcome may make, and only where the parent tool is already allowed |

### The lists as they stand (what default-deny will enforce)

| Stage | Session | Tools | Skills resolved |
|---|---|---|---|
| `ai_objective_review` | objective review | `Read, Glob, Grep, Write` | — |
| `ai_product_review` | product review | `Read, Glob, Grep, Write` | — |
| `ai_design_review` | design review | `Read, Glob, Grep, Write` | — |
| `ai_plan_review` | plan review | `Read, Glob, Grep, Write` | — |
| `ready_to_execute` | execute | `Read, Glob, Grep, Write, Edit, Bash` | `simplify` → `+ Skill` |
| `ai_qa` | QA | `Read, Glob, Grep, Write, Bash` | `security-review` → `+ Skill` |
| `cleanup_ready` | cleanup | `Read, Glob, Grep, Write, Edit, Bash` | — |
| `cleanup_ready` | decision | `Read, Glob, Grep, Write` | — |

### Product requirements

| ID | Requirement |
|---|---|
| F2.1 | A tool not in the lap's list is **denied by the hook**, with a reason naming the stage |
| F2.2 | Context is narrowed with the SDK `tools` option set to the lap's list — never with a hand-kept complement of built-ins, which will always be behind (C2) |
| F2.3 | Review laps list `Grep` and `Glob` explicitly, because native builds may otherwise route search through `Bash` (C2) |
| F2.4 | Narrowing is a UX/context measure only. Acceptance depends on F2.1 alone; no test asserts security on narrowing |
| F2.5 | **No `tools:` config key in this task.** A per-lap list override is a real request the MCP denial will generate; it is a follow-up with its own questions, not a switch added in passing (Q8) |
| F2.6 | The denial message for an out-of-list tool is legible enough to diagnose a skill that asked for it: it names the tool and the stage |

---

## F3 — Refusing to race: the pre-flight check

*From: Q1 (confirming #6's Q7), Q7; C3.1.*

### Triggers, in order

A `drive` invocation runs these checks **before any session starts and before any repository side
effect** — in particular before the task's branch is checked out, so a refused `drive` leaves the
working copy exactly as it was.

| # | Check | Fails when | Fix named in the message |
|---|---|---|---|
| 1 | **SDK version** | installed SDK ≠ the pinned, probed version | Reinstall vibe-racer, or remove the `overrides` entry for the SDK |
| 2 | **Hook registered** | the options object about to be passed has no `hooks.PreToolUse` entry | None — internal defect; report it |
| 3 | **Audit log not tracked by git** | `.vibe-racer/audit.log` is tracked | `git rm --cached .vibe-racer/audit.log` |
| 4 | **Audit log writable** | the file cannot be opened for append, or rotation would fail | Names the path it could not write |

Checks 1–2 are properties of the install; checks 3–4 are properties of the project. All four run
once per `drive` invocation, not once per task.

### Message contract (Q1)

Every refusal carries three things, in this order:

1. **what is wrong**,
2. **that nothing was spent** — keep this line; it is what stops a user retrying in a panic,
3. **the one concrete command that fixes it**.

Only the **first** failing check is reported. A refusal is a thing to act on, not a report to read.

The SDK-mismatch message must **not** tell the user to install the SDK: vibe-racer is a globally
installed CLI, the SDK lives inside its own install, and
`npm install @anthropic-ai/claude-agent-sdk@…` in the user's project would add a package to *their*
repository and change nothing. It names the two real causes and their fixes, and points at the docs
section explaining the pin. Reference wording from the objective:

```
Refusing to start the product-review lap: the tool guard has not been verified against the
installed SDK (found 0.3.271, verified 0.3.270). No session was started and nothing was spent.
```

Every refusal also carries one clause acknowledging the legitimate need: a user who genuinely wants
an unguarded agent in this repository already has one — `claude` directly (Q1).

### Product requirements

| ID | Requirement |
|---|---|
| F3.1 | **Hard stop. No `--unguarded` flag, no env-var escape, no warn-only mode** (Q1, confirming #6 Q7/Q8) |
| F3.2 | Exit code is non-zero |
| F3.3 | `state.yml` is **not** moved to `error` — nothing was attempted, the task stays where it was, and `drive` works again once the install is fixed |
| F3.4 | The audit-log writability probe opens for append and closes; it does **not** write an entry, so a lap with no denials leaves the log untouched (Q1 + Q7) |
| F3.5 | Nothing is committed, no branch is created or checked out, no state file is written |
| F3.6 | The SDK check is an **equality** assert against an exactly pinned version, not a range (C3.1) |

---

## F4 — Denial surfaces: inline, collapsed, summarised

*From: Q2.*

### Three volumes

**1. Inline, one line per distinct denial.** Keep the existing shape:

```
Denied: Bash 'curl https://example.com' — network access blocked
```

It is the only thing that explains why the agent just changed course; hiding it makes laps look
stalled for no reason. The three fields (tool, input, reason) are already right.

**2. Collapsed duplicates.** The first denial of a `(tool, reason)` pair prints in full; subsequent
identical pairs are suppressed inline. An agent that retries a blocked `Bash` eight times costs
eight audit entries and one screenful, not eight.

**3. End-of-lap summary**, printed whether the lap succeeded or failed:

- the total denial count,
- the distinct `(tool, reason)` pairs with how many times each fired,
- the audit log path.

One block, no per-call repetition.

### Product requirements

| ID | Requirement |
|---|---|
| F4.1 | A lap with **zero** denials prints **nothing** — silence is the signal that the normal case is clean; a "0 denials" line on every lap trains users to ignore the surface (Q2) |
| F4.2 | The summary prints the audit log **path**, never the entries — output may be pasted into an issue and entries can hold something sensitive the agent tried to run (Q2 + Q7) |
| F4.3 | The summary is printed for a lap that errored, not only one that completed |
| F4.4 | Every denial — including suppressed duplicates — produces its own audit entry |
| F4.5 | **No `vibe-racer audit` command in this task.** The path in the summary is enough; a reader is a follow-up once we know whether anyone opens the file (Q2) |

---

## F5 — The heartbeat and the bypass incident

*From: Q3; C3.3.*

### Mechanism (C3.3)

The hook records every `tool_use_id` it is invoked for. `runAndStream` checks each `tool_result`
arriving on the stream against that set and **aborts the session on the first result whose call the
hook never saw**. Comparing counts at the end of the session compared them after the damage was
done.

### What an abort means, and what it does (Q3)

An abort is a **security incident, not a retryable failure**: an unguarded tool call happened, and
the session is being killed with partial work on disk.

| ID | Requirement |
|---|---|
| F5.1 | The task moves to **`error`**, with a message that distinguishes a guard bypass from an ordinary session failure: which tool bypassed the guard, and that the lap was stopped mid-flight |
| F5.2 | **Do not commit the session's work.** vibe-racer's promise is one commit per lap; an aborted lap has no lap to commit. The one thing committed is `state.yml` itself, alone, so the bypass marker survives the user discarding the rest of the tree |
| F5.3 | **Do not roll back.** The partial work stays in the working tree, uncommitted and visible in `git status`, so the user can `git diff` to see exactly what the session did — including what the unguarded call did. Silently reverting would destroy the only evidence of the bypass |
| F5.4 | The abort is recorded in the audit log as its own entry type — it belongs in the same file as the denials, since both answer "what did the guard do on this task" |
| F5.5 | The error record carries two facts beyond the message: that this is a guard bypass, and the vibe-racer version that hit it |

### The retry gate, and the way out (Q3)

`drive --retry` must refuse this error state specifically. Every other `error` is retryable; this
one means the enforcement mechanism is not behaving as probed, so retrying just spends money to
bypass the guard again.

`state.yml` is pipeline-owned, so "edit it by hand" cannot be the exit. Instead, `--retry` on a
bypass error refuses **until both** of these hold, and says which one is missing:

| Condition | Why |
|---|---|
| The installed vibe-racer is a **different version** from the one recorded with the error | The mechanism that failed has been replaced — the only thing that makes a retry more than a repeat |
| The **working tree is clean** | The user has looked at what the aborted session left and committed or discarded it. Otherwise the retried lap's commit would sweep the bypassed call's output in with its own (`commitAll` stages everything) |

The refusal message names the audit log and the dirty working tree as the two artefacts to attach
to a report, and says the block is deliberate. **If no fixed version exists yet, the task waits.**
That is the real cost of this design, stated rather than softened.

### Blocking prerequisite — the false-abort probe (Q3)

C3.3 flags three unprobed cases that could make the heartbeat abort healthy sessions: a call to a
tool removed from context by F2.2, a subagent's calls, and `server_tool_use`. Given the design
above, a false abort is expensive — it errors a task and blocks its retry.

> **The live-tier probe of all three is a blocking prerequisite for shipping the heartbeat's abort
> behaviour.** If any one of them produces a `tool_result` without a `PreToolUse` invocation and the
> rule cannot be narrowed to exclude it, the heartbeat ships in **warning-only form** (print, audit,
> do not abort) and the abort becomes its own task.

**The guard itself — the part acceptance depends on — ships either way.** This is a planned fork,
not a risk: the plan carries both outcomes and the probe result selects one.

---

## F6 — The audit log becomes real

*From: Q7.*

The audit log is **local evidence, never committed, and never silently incomplete.**

| ID | Requirement |
|---|---|
| F6.1 | **`.vibe-racer/` ignores itself.** Whenever vibe-racer creates that directory it also writes `.vibe-racer/.gitignore` containing `*`. No edit to the user's own `.gitignore`, no dependence on `init` having run — it covers projects initialised before this release the first time a guarded lap starts. The two documents that already claim "gitignored" become true rather than being reworded |
| F6.2 | **A tracked audit log is a refusal, not a cleanup.** If `.vibe-racer/audit.log` is already tracked when a lap starts, the lap does not start (F3 check 3). vibe-racer does not untrack a file on the user's behalf |
| F6.3 | **The cap rotates instead of dropping.** At 1 MB, `audit.log` is renamed to `audit.log.1` (replacing any earlier one) and a fresh `audit.log` starts. Bounded at two files; no entry is discarded without a trace. Today's behaviour — silently returning once the file is at the cap — is incompatible with F3 check 4 making "a denial that is not recorded" a reason to refuse a lap |
| F6.4 | If rotation itself fails, that is F3 check 4 and the lap refuses |
| F6.5 | **This repository's own `.gitignore` is corrected** (`.viberacer/` → `.vibe-racer/`), and its stale `.viberacer-secrets` line is checked against what the secret scanner actually reads |
| F6.6 | **`docs/security.md` says what the log may contain:** denied commands and paths, verbatim. It can hold something sensitive the agent tried to run. That is acceptable for a local, ignored file — and is the reason it must stay one, and the reason F4.2 prints the path and never the entries |

---

## F7 — Banners that cannot lie

*From: objective "What" bullet 3; Q8's closing note.*

| ID | Requirement |
|---|---|
| F7.1 | `formatGuardSummary` is printed only when the enforcement it describes is installed |
| F7.2 | The banner prints the list that is **enforced** — after this task the same list that is offered (Q8) |
| F7.3 | `init`'s line no longer names `canUseTool` (today: `Security: canUseTool path-jail enabled (project root only)`) and describes the mechanism actually used |
| F7.4 | The banner's jail note continues to mirror the jail condition exactly, as it does today |

---

## F8 — The surfaces that stay unguarded

*From: Q6; plus the `fasten` surface, flagged in §18.*

### `radio` (Q6)

`radio` is the user's own interactive `claude` CLI; the guard has never applied and does not after
this task.

| ID | Requirement |
|---|---|
| F8.1 | `radio` prints **one line** before the interactive session opens: that this is the user's own `claude` CLI, that the guard does not apply, and that nothing here is restricted |
| F8.2 | **No prompt, no confirmation.** `radio` is explicitly interactive and attended; a user sitting at a prompt they asked for should not be asked to confirm it |
| F8.3 | The README's "two things the guard does not do" paragraph is kept and its second half updated, since #6 is what closes the push gap |

### Mid-pipeline tasks (Q6)

**No migration, no warning, nothing built.** Every command re-reads state from disk and every lap
is independent, so an in-flight task simply gets a guarded next lap. The upgrade story is "the
guard starts working" — the fix, not a breaking change. One CHANGELOG line.

The one real edge case: a task whose earlier laps wrote files outside the plan folder that a later
guarded lap now cannot touch. It surfaces as an ordinary denial with an ordinary reason, is counted
in the F4 summary, and is resolved by F10's classification like any other. **No special-casing, no
grandfathering — grandfathering is how a guard stops being a guard.**

---

## F9 — Disclosure

*From: Q5 (confirming #6's Q9).*

All four channels of #6's Q9 are confirmed as settled:

| Channel | Content |
|---|---|
| CHANGELOG | A **Security** entry saying plainly that 0.3.0 did not enforce the tool guard; plus a **Changed** line for the MCP/`Task`/`WebFetch` denial (F2) and one line on mid-pipeline tasks (F8) |
| `SECURITY.md` and `docs/security.md` | One dated line each |
| npm | `npm deprecate vibe-racer@0.3.0` with a one-line pointer at the fixed version — **operator's, after `done`** |
| Interim warning | Two places, below |

### Wording of the dated line — exact

> **"0.3.0 did not enforce the tool guard; earlier versions are unverified."**

Do **not** write "never enforced since 0.1.0" — it was not probed. Do **not** write "a bug in 0.3.0
only" — that implies earlier versions were fine.

### The interim warning: two places, both editable without a release (Q5)

1. **A short admonition at the top of the README's Security section** — not the top of the README;
   it is a wiring bug in a released version, not a reason to scare off every reader at line one.
   Names 0.3.0, what it means in one sentence, and the version that fixes it once that exists.
2. **The GitHub issue #7 thread**, as the canonical public record, with the probe table from the
   objective. Users who search the symptom land there.

**Not in `drive`'s own output.** A user running the fixed version does not need a warning about the
version they are not running, and a user running 0.3.0 will never get the new code that prints it.
That is the trap worth naming: **nothing shipped in this task can warn a 0.3.0 user**, which is why
`npm deprecate` carries the weight and must not be skipped.

### Removal is structural, not remembered (Q5)

Not a row in the Execution Status table — a post-`done` release step never is, and the
`need_execution` sign-off refuses a plan whose table ends in an operator row with nothing after it.
The structure comes from where the two edits live:

- **The interim admonition goes onto `main` now, by the operator, outside the pipeline** — a
  one-paragraph README edit, not a task. It has to be on `main` to be seen at all and cannot wait
  for this task's cycle.
- **This task's branch replaces it.** One milestone rewrites that same README paragraph into the
  permanent wording. **Merging the task is the removal** — there is no version of `main` that has
  the fix and still carries the interim warning.
- **The merge will conflict on that one paragraph**, since `main` changed it after the branch was
  cut. Expected, resolved in favour of the branch, and **said in the `done` lap's decision
  document** so it is not a surprise at merge time.

---

## F10 — The pre-release dry run

*From: Q4; objective "What" bullet 5.*

### Resolving the constraint conflict (Q4)

The objective's constraint says "guardrails only tighten — a rule that turns out to be wrong once it
really runs is fixed as its own recorded decision", while the dry-run step says each denial is
recorded as "correct-and-prompt-fixed or wrong-and-rule-fixed". Q4 resolves this **in favour of
shipping, with a bright line**:

> This task may narrow a rule **only** where the rule blocks a lap from completing its own
> documented job, and every such narrowing is recorded in `05_qa.md` with the denial that motivated
> it. It may not broaden what any lap can reach beyond that lap's documented job, and it may not
> remove a rule.

### The three outcomes available per denial

| Outcome | When | What ships |
|---|---|---|
| **correct-and-prompt-fixed** | The rule is right; the agent should not have tried | Prompt or skill change, rule untouched. **The preferred outcome — prefer it whenever both would work** |
| **correct-and-gate-row** | The rule is right and the step genuinely must happen | Nothing changes; the step becomes an `Owner = operator` gate row at plan time. Uses machinery that already exists |
| **wrong-and-rule-narrowed** | The lap cannot do its documented job at all | Minimal narrowing, recorded with the denial, the lap, and why the other two outcomes did not apply |

A denial needing a narrowing **larger than one lap's documented job** — anything re-opening the
project root at a review stage, or unblocking `Bash` wholesale — stops being this task's business:
it ships as a recorded `05_qa.md` finding and its own follow-up, and this task ships with the tight
rule. **A surprising dry run delays a rule fix, never the disclosure.**

### Who runs it, and where it sits in the plan (Q4)

The dry run is seven real, paid sessions against a throwaway task. An execute session cannot start
them — it has no business spawning `drive`, and the spend is the operator's. So it is planned, not
improvised:

| Row | Owner | What happens |
|---|---|---|
| …the milestones that build the guard… | agent | |
| **Gate — dry run** | operator | In a scratch repository, with this branch's build linked, race a throwaway task through all seven laps. Leave the resulting `.vibe-racer/audit.log` and one line per lap (completed / could not complete) where the next milestone can read them |
| **Classify and fix** | agent | Every denial in that log is put in one of the three rows above; prompt fixes and any narrowing are made here, each recorded with the denial that motivated it |
| **Gate — re-run what changed** | operator | Re-race only the laps whose prompt or rule the previous row changed. If none changed, the checklist says so and is ticked without a run. **A narrowing that has not been seen to work under the live guard is not shipped on its author's word** |
| **Record the result** | agent | The final per-lap table, written where the QA lap reads it for `05_qa.md` |

Both gates are followed by the milestone they unblock, and neither merges, pushes or releases
anything. **One round of re-run is planned; a second failure is not another row — it is a
`needs_operator` pause and a conversation.**

### Pass bar (Q4)

> Every lap completed its own document once, under the live guard, with every denial classified
> into one of the three rows above and none left unexplained. **A lap that cannot complete is a
> blocker, not a note.**

---

## 13. State machine and workflow

### 13.1 `drive` with the pre-flight check (F3)

```
vibe-racer drive
   │
   ├─ task selection (reads only; no lap to run ⇒ no pre-flight)
   │
   ├─ pre-flight (once per invocation, before any side effect)
   │     1. SDK version == pinned?            ── no ─┐
   │     2. hooks.PreToolUse present?         ── no ─┤
   │     3. audit.log not tracked by git?     ── no ─┤
   │     4. audit.log writable / rotatable?   ── no ─┤
   │                                                  │
   │                                      REFUSE: what is wrong
   │                                            + nothing was spent
   │                                            + the one fixing command
   │                                      exit != 0 · stage unchanged
   │                                      no branch, no commit, no state write
   │     all pass
   ▼
 branch checkout → dispatch(stage) → guarded session
```

### 13.2 A guarded session

```
session start
   │  print Guard banner (F7 — only because enforcement is installed)
   ▼
 tool call ──► PreToolUse hook ──► decision
   │                │                 │
   │                │                 ├─ allow  ──► tool runs
   │                │                 └─ deny   ──► tool does not run
   │                │                               • inline warning (first of its
   │                │                                 (tool, reason) pair only)
   │                │                               • audit entry (always)
   │                └─ record tool_use_id
   ▼
 tool_result arrives on the stream
   │
   ├─ id was recorded ──► continue
   └─ id was never seen ──► HEARTBEAT ABORT (F5)
                              • audit entry, own type
                              • stage := error, bypass marker + version recorded
                              • state.yml committed alone; no commit of the session's work,
                                no rollback — partial work left in the tree
                              • --retry blocked until version differs AND tree is clean
   ▼
 session end
   └─ denial summary (F4) — count, distinct (tool, reason) pairs, log path
      printed on success and on failure; nothing at all if zero denials
```

### 13.3 Pipeline stages — unchanged

This task adds **no stage** and changes **no transition**. `STAGE_ORDER`, `NON_LINEAR_STAGES`, the
`need_operator` detour, `STAGE_QUESTIONS_FILE` and the Execution Status table contract are all
untouched. The only state-machine-adjacent change is F5: a new *reason* for reaching the existing
`error` stage, and a condition on leaving it via `--retry`.

---

## 14. Configuration and prerequisites

### 14.1 New prerequisites

| Prerequisite | Enforced by | On failure |
|---|---|---|
| SDK installed at the exact pinned version | F3 check 1 | `drive` refuses |
| `.vibe-racer/audit.log` untracked | F3 check 3 | `drive` refuses, names `git rm --cached` |
| `.vibe-racer/` writable | F3 check 4 | `drive` refuses, names the path |

### 14.2 `package.json`

The SDK dependency moves from `^0.3.270` to the **exact** `0.3.270`, no caret (C3.1). With a caret,
a verified-range check is either so narrow it refuses every user who installs tomorrow or so wide it
verifies nothing. The pin is stronger than it looks: the SDK pins its per-platform binary packages
to the same exact version, so this also fixes the executable that honours the hook. The runtime
check becomes an equality assert that fires only on an `overrides` entry or a hand-linked SDK, and
**bumping the SDK becomes a deliberate act that re-runs the live probes**.

### 14.3 `.vibe-racer.yml`

**No new keys.** Specifically no `tools:` override (F2.5). `skills:` and `max_turns:` keep their
current meaning; a lap with a resolved skill still gets `Skill` in its list.

### 14.4 No new runtime dependencies

Per the objective's constraints. Build, lint and tests pass at every milestone; coverage only up.

### 14.5 Test tiers (C4)

| Tier | Scope | Runs |
|---|---|---|
| 1 | Rules, via the transport-neutral decision function directly | `npm run test` |
| 2 | Wiring: `hooks.PreToolUse` present, `canUseTool` absent, the captured hook denies in the SDK's real input shape, the heartbeat contract | `npm run test` |
| 3 | Opt-in live suite — the probes, the three false-abort cases, the settings re-grant case | `npm run test:live` |

A global `process.on("warning")` listener **cannot fire in tiers 1–2** — `query` is mocked and the
SDK code that emits the warning never runs. It belongs in the live tier only; in tiers 1–2 the
equivalent protection is the `canUseTool`-is-absent assertion (C4).

If the live tier cannot run without a paid session in CI, it becomes a documented manual check in
the release steps (objective, "What" bullet 4).

---

## 15. Edge cases and error recovery

| # | Case | Behaviour |
|---|---|---|
| E1 | SDK newer than the pin (the common case) | F3 check 1 refuses. Names reinstall or the `overrides` entry — never "install the SDK" (Q1) |
| E2 | Audit log at the 1 MB cap mid-lap | Rotates to `audit.log.1`; the denial is still recorded (F6.3) |
| E3 | Audit log tracked by git | F3 check 3 refuses with `git rm --cached` (F6.2) |
| E4 | Read-only mount / unwritable `.vibe-racer/` | F3 check 4 refuses, names the path (Q1) |
| E5 | Project settings re-grant a tool (`settingSources: ["project","user"]` with `permissions.allow: ["Bash"]`) | The hook has no matcher and sees the call regardless; a re-granted out-of-list tool is still denied. **Settled by a live test** (C2) |
| E6 | MCP tools present even with `settingSources: []` | Stopped by the hook's default-deny. Whether `strictMcpConfig: true` also keeps them out of *context* is unverified — probe it (C2) |
| E7 | A skill instructs the agent to use an out-of-list tool | Ordinary denial; the message names the tool and the stage so the cause is legible (Q8) |
| E8 | A lap stalls because it lacks `TaskOutput`/`TaskStop`/`ToolSearch` | The dry run decides; adding one where its parent tool is already allowed is the only list change F10's third outcome may make (Q8) |
| E9 | Agent retries a blocked call many times | First printed in full, duplicates suppressed, every attempt audited, count in the summary (F4) |
| E10 | Heartbeat fires on a **healthy** session (C3's three unprobed cases) | Blocking live probe before shipping the abort; otherwise the heartbeat ships warning-only (F5) |
| E11 | Bypass abort with no fixed version available yet | The task waits. Stated, not softened (Q3) |
| E12 | Bypass abort, user wants to retry with a dirty tree | `--retry` refuses and says which of the two conditions is missing (Q3) |
| E13 | Ordinary session failure (not a bypass) | Unchanged: `setError`, retryable with `--retry` as today |
| E14 | A task whose earlier laps wrote outside the plan folder | Ordinary denial, ordinary reason, F10 classification. No grandfathering (Q6) |
| E15 | The skill-discovery probe session (`maxTurns: 0`) inside `runAndStream` | Runs no tools and is not a guarded session. It starts **after** pre-flight, so a refused `drive` never reaches it. Named in `docs/security.md` so it is not mistaken for a gap |
| E16 | `error` state with an unrecognised `error_stage` | Unchanged: `drive` tells the user to set `stage:` by hand. A bypass error always records a recognised stage |
| E17 | `radio` at any stage | One-line notice, no guard, no confirmation (F8) |
| E18 | `fasten`'s analysis session | See §18 — a decision this lap surfaces and the operator confirms |

---

## 16. Scope boundaries

### In scope

- Moving Layer 2 to a `PreToolUse` hook; dropping `canUseTool` (F1)
- Default-deny on the lap's tool list; the Q8 baseline; `tools`-option context narrowing (F2)
- Pre-flight refusal with four triggers (F3)
- Inline denials, duplicate collapsing, end-of-lap summary (F4)
- The heartbeat, the bypass error, the conditional retry block (F5)
- Audit log: self-ignoring directory, tracked-file refusal, rotation, documented contents (F6)
- Honest `Guard:` and `init` banners (F7)
- `radio`'s one-line notice (F8)
- Disclosure across four channels; the interim warning and its structural removal (F9)
- The dry run, its two gates, its three outcomes and its pass bar (F10)
- Tests in three tiers; the regression test that a denial lands in `.vibe-racer/audit.log`
- Docs: `SECURITY.md`, `docs/security.md`, `docs/how-it-works.md`, `CLAUDE.md`, README, CHANGELOG

### Out of scope — and why

| Not doing | Why |
|---|---|
| The no-push deny list, the merge ban in plans, `drive` on the task branch | **#6**, which races after this task merges |
| Guarding `radio` | Out of scope by the objective; it is the user's own `claude` CLI. It gets a notice (F8), not a guard |
| Leaving `bypassPermissions` | The sessions are unattended by design |
| A `--unguarded` flag, env escape, or warn-only period | Q1 and #6's Q7/Q8. The landing is softened by the dry run, not by a mode |
| `vibe-racer audit` (a log reader) | Q2 — follow-up once we know whether anyone opens the file |
| A `tools:` config key to extend a lap's list | Q8 — a real request the MCP denial will generate, with its own questions |
| Allowing `Task`, `WebFetch`, `WebSearch` or MCP tools anywhere | Q8. `Task` revisits only with C3's subagent probe in hand |
| Changing what any rule decides | Objective constraint. Narrowing is permitted only inside F10's bright line |
| Merge, version bump, publish, `npm deprecate vibe-racer@0.3.0` | **Operator's, after `done`.** Never rows in the Execution Status table |
| The interim README admonition on `main` | Operator's, **now**, outside the pipeline (F9) |
| Grandfathering tasks mid-pipeline | Q6 — grandfathering is how a guard stops being a guard |

---

## 17. Acceptance criteria

### A. Enforcement, in a real session under `bypassPermissions` (objective "Acceptance")

- [ ] A `Write` outside the plan folder at a review stage is **denied** and **audited**
- [ ] `Bash` at a review stage is **denied**
- [ ] A `BASH_BLOCKLIST` command at `ready_to_execute` is **denied**
- [ ] A tool outside the lap's list is **denied** or **absent from the session's tool list**
- [ ] An agent `Write`/`Edit` to any `state.yml` under `plans_dir` is denied at every stage (Rule 0, unchanged)

### B. Wiring and tests

- [ ] The guard is registered under `hooks.PreToolUse` in the options `query` receives
- [ ] `canUseTool` is **absent** from those options
- [ ] **The wiring test fails if the guard is passed only as `canUseTool`**
- [ ] Tier-2 test: the captured hook denies in the SDK's real input shape
- [ ] Regression test: a write outside the plan folder lands a denial in `.vibe-racer/audit.log`
- [ ] Tier-1 rule tests call the transport-neutral decision function directly
- [ ] A live-SDK check exists as `npm run test:live`, or as a documented manual release step if it cannot run unpaid in CI
- [ ] Rule conditions and messages are byte-identical to today's, except where F10 recorded a narrowing; audit entries keep their five existing fields unchanged and gain two (`kind`, `rule`)

### C. Refusal

- [ ] Each of the four triggers refuses, reporting only the first failure
- [ ] Every refusal states what is wrong, that nothing was spent, and one fixing command
- [ ] The SDK message names reinstall and the `overrides` entry, and does not tell the user to install the SDK
- [ ] Exit code non-zero; `state.yml` unchanged; no branch checkout, commit or state write
- [ ] `drive` succeeds again once the cause is fixed, from the same stage
- [ ] No `--unguarded` flag or env escape exists

### D. Denial surfaces

- [ ] One inline line per distinct `(tool, reason)` pair; duplicates suppressed
- [ ] Every denial, including suppressed ones, is audited
- [ ] End-of-lap summary on success and on failure: count, distinct pairs with counts, log path
- [ ] A lap with zero denials prints nothing
- [ ] The summary prints the path, never the entries

### E. Heartbeat

- [ ] The three false-abort cases are probed in the live tier **before** the abort ships
- [ ] If any is unresolvable, the heartbeat ships warning-only and the guard still ships
- [ ] An abort: audits its own entry type, moves to `error` with a bypass-distinct message, records the vibe-racer version, commits `state.yml` alone and nothing the session wrote, does not roll back
- [ ] `--retry` on a bypass error refuses until the version differs **and** the tree is clean, and says which is missing
- [ ] `--retry` on every other `error` is unchanged

### F. Audit log

- [ ] `.vibe-racer/.gitignore` containing `*` is written whenever the directory is created, independent of `init`
- [ ] A tracked `audit.log` refuses the lap and names `git rm --cached`
- [ ] At 1 MB the log rotates to `audit.log.1`; no entry is dropped silently
- [ ] This repo's `.gitignore` says `.vibe-racer/`; the `.viberacer-secrets` line is checked against the scanner
- [ ] `docs/security.md` states that entries hold denied commands and paths verbatim

### G. Banners and notices

- [ ] `formatGuardSummary` prints only when enforcement is installed, and prints the enforced list
- [ ] `init`'s line does not say `canUseTool`
- [ ] `radio` prints its one-line notice before the session opens, with no confirmation prompt

### H. Dry run

- [ ] Both gates are `Owner = operator` rows, each followed by the milestone it unblocks
- [ ] Every lap completed its own document once under the live guard
- [ ] Every denial is classified into one of the three outcomes; none unexplained
- [ ] Every narrowing is recorded in `05_qa.md` with the denial, the lap, and why the other outcomes did not apply
- [ ] Laps whose prompt or rule changed were re-run; if none changed, the checklist says so
- [ ] The final per-lap table is where the QA lap reads it

### I. Disclosure and docs

- [ ] CHANGELOG: a Security entry for 0.3.0, a Changed line for the MCP/`Task`/`WebFetch` denial, a line on mid-pipeline tasks
- [ ] `SECURITY.md` and `docs/security.md` carry the exact dated line, with no "since 0.1.0" and no "0.3.0 only"
- [ ] `SECURITY.md`, `docs/security.md`, `docs/how-it-works.md`, `CLAUDE.md` and README name the mechanism actually used
- [ ] The README Security admonition is rewritten on this branch into the permanent wording
- [ ] The `done` lap's decision document names the expected README merge conflict and that it resolves in favour of the branch
- [ ] The three honest limits of §2 appear in `docs/security.md`

---

## 18. Open items the operator confirms by ticking

Two amendments, surfaced rather than assumed. Ticking the design-questions file confirms both;
striking a paragraph here rejects one.

### 18.1 Q4 amends an objective constraint (carried from Q4, restated for visibility)

The objective says a wrong rule "is fixed as its own recorded decision", which read strictly means
never in this task. F10's third outcome allows one narrow case inside it. **If that is not wanted,
strike the third row of F10's table**: the dry run then has two outcomes, and a lap that cannot do
its job under the live guard blocks the release until a follow-up task lands.

### 18.2 `fasten`'s session is a third unguarded surface, named by none of Q1–Q8

`src/claude/fasten.ts` runs a session with `allowedTools: ["Read", "Glob", "Grep"]`,
`stage: "ai_objective_review"` and an empty `taskPlanPath`. A guard is therefore already built for
it, and like every other one it has never run. It is not a lap, so F10's dry run does not cover it,
and the objective's acceptance criteria do not mention it.

**Once the hook is wired, `fasten` is guarded whether or not anyone decides it** — so the decision
is what profile it gets, not whether. Left alone it would inherit the objective-review list, which
includes `Write`, with a plan jail that an empty `taskPlanPath` resolves to the whole project.

**Decision: an explicit read-only profile** (`Read, Glob, Grep`; no `Write`, no `Edit`, no `Bash`)
enforced by the same hook, and the same pre-flight check as `drive` before its session starts. It
only makes true a list the code already declares, it keeps "every session vibe-racer starts is
guarded" a sentence with no exceptions, and it means the banner cannot lie about `fasten` either.
Verification is one manual check in the release steps, not a dry-run lap.

**If struck**, `fasten` keeps the objective-review profile it inherits today. Leaving it unguarded
like `radio` is not on offer: that would mean building an exemption.

---

## 19. Traceability

| Feature | Source |
|---|---|
| F1 Hook transport, `canUseTool` dropped | Objective "What" 1; C1 |
| F2 Default-deny, tool baseline, `tools` narrowing | **Q8**; Objective "What" 2; C2 |
| F3 Pre-flight refusal, four triggers, message contract | **Q1**; #6 Q7/Q8; C3.1 |
| F4 Inline denial, collapsing, end-of-lap summary | **Q2** |
| F5 Heartbeat, bypass error, retry gate, blocking probe | **Q3**; C3.3 |
| F6 Audit log: self-ignore, tracked refusal, rotation, contents | **Q7** |
| F7 Honest banners | Objective "What" 3 |
| F8 `radio` notice, no migration for mid-pipeline tasks | **Q6** |
| F9 Disclosure, interim warning, structural removal | **Q5**; #6 Q9 |
| F10 Dry run, three outcomes, two gates, pass bar | **Q4**; Objective "What" 5 |
| SDK exact pin; warning canary; test tiers | C3.1, C3.2, C4 |
| Release steps are the operator's, after `done` | Objective "Release" |
