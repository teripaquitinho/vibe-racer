# Objective

**The tool guard does not run.** Make the guard and the per-lap tool list real under the
permission mode the sessions run in. This was Milestone 0 of #6 (drive-enforcements); it is its
own task because it has to complete its whole cycle — QA, `done`, merge, release — before #6
starts executing, and a task cannot release one milestone ahead of the rest without the mid-cycle
merge #6 exists to forbid.

**Numbering.** This is task #7, and the user report it answers is GitHub issue #7 — the same
subject, by coincidence of numbering. The *former follow-up* `0007_qa-scope-survives-mid-task-merges`
that #6's documents mention is unrelated and was closed there.

## Why

`runAndStream` (`src/claude/session.ts`) starts every session with
`permissionMode: "bypassPermissions"` and passes the guard as `canUseTool`. Under the installed SDK
(`@anthropic-ai/claude-agent-sdk` 0.3.270) that mode approves every tool call before the callback
is consulted. The SDK says so itself on every session, as a Node warning with code
`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`:

> canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call
> (except explicit deny rules) before the callback is consulted. To gate every tool call, use a
> PreToolUse hook instead.

Three live probes against that SDK, each a throwaway session in a scratch directory with
`settingSources: []`:

| Session | Asked to | Result |
|---|---|---|
| bypass + a `canUseTool` that denies everything | `Write` a file | callback called **0** times; file written |
| bypass + a `PreToolUse` hook that denies everything | `Write` a file | hook called once; file **not** written |
| bypass + `allowedTools: ["Read", "Glob", "Grep"]`, no guard | `Write` a file, then `touch` one with `Bash` | both tools in context, both ran, both files created |

So Layer 2 (Rule 0, the path jail, the plan-folder jail at review stages, the Bash block at review
stages, `BASH_BLOCKLIST`, the sensitive-path rules, the audit log of denials) does not run, and
Layer 1 does not restrict either: `allowedTools` is an auto-approve list, not a filter on what the
model can call. Meanwhile the session log prints `Guard: path-jail to ./<plan> · …`, `init` prints
`Security: canUseTool path-jail enabled`, and `SECURITY.md`, `docs/security.md`,
`docs/how-it-works.md`, `CLAUDE.md` and the README all describe both layers as enforced.

**What is and is not established.** The probes ran against SDK 0.3.270 only. npm
`vibe-racer@0.3.0` (published 2026-09-13) ships the same wiring and the same SDK range, so 0.3.0
is affected. 0.1.0 and 0.2.0 used the same wiring against SDK `^0.2.62`, which nobody has probed:
say "0.3.0 did not enforce the guard" and "earlier versions are unverified", not "never enforced
since 0.1.0".

The tests do not catch it: `tests/claude/session.test.ts` mocks `query`, pulls `canUseTool` out of
the options it was called with and invokes it by hand. That proves the callback is passed, not
that anything calls it.

Reported independently the same day by a user trialling 0.3.0 on a host project: GitHub issue #7
(#8 was its duplicate, closed).

## What

- **Layer 2 moves to where the SDK consults it.** The rules in `src/claude/guard.ts` stay as they
  are — same rules, same messages, same audit entries — and run from a `PreToolUse` hook. Every
  tool call of every guarded session goes through it, including tools not in the lap's list.
- **Layer 1 becomes a restriction.** A tool that is not in the lap's list is denied, not merely
  left unlisted. `Skill` keeps its existing allowance when a lap resolves skills.
- **The log line cannot lie.** `formatGuardSummary` and the `init` line are printed only when the
  enforcement they describe is installed, and `init`'s wording no longer names `canUseTool`.
- **`drive` refuses to start a lap it cannot guard**, before any session is started.
- **A test that would have caught this.** A wiring test asserts the guard is registered under
  `hooks.PreToolUse` in the options `query` receives and that a tool outside the lap's list is
  denied. A regression test attempts a write outside the plan folder and asserts the denial lands
  in `.vibe-racer/audit.log` (suggested in issue #7). A live-SDK check like the probes above is
  added if it can run without a paid session in CI; if not, it is a documented manual check in the
  release steps.
- **A dry run before release.** Every lap is run once for real against a throwaway task with the
  guard live and its audit log read; each denial is recorded in this task's `05_qa.md` as
  correct-and-prompt-fixed or wrong-and-rule-fixed.
- **Docs.** `SECURITY.md`, `docs/security.md`, `docs/how-it-works.md`, `CLAUDE.md` and the README
  name the mechanism actually used; the two security documents carry one dated line that 0.3.0 did
  not enforce the guard; the CHANGELOG carries a Security entry saying so plainly.

**Acceptance.** In a real session under `bypassPermissions`: a `Write` outside the plan folder at
a review stage is denied and audited; `Bash` at a review stage is denied; a `BASH_BLOCKLIST`
command at `ready_to_execute` is denied; a tool outside the lap's list is denied or absent from
the session's tool list. The wiring test fails if the guard is passed only as `canUseTool`.

## Release — the operator's, after `done`

Not rows in any plan: merge, version, publish and `npm deprecate vibe-racer@0.3.0` (with a
one-line pointer at the fixed version) happen after this task's `done`. `main` already
carries #5's unreleased work, so the release that contains this fix is not a patch of 0.3.0 unless it is
cut from a `v0.3.0` hotfix branch; the version number is the operator's call. Until it is out,
anyone trying vibe-racer is told to treat a `drive` session as an unrestricted agent in the repo.

## Out of scope

- The no-push deny list, the merge ban in plans, and `drive` on the task branch — all #6, which
  races after this task is merged.
- `radio`, where the guard does not run, before or after this task.
- Leaving `bypassPermissions`. The sessions are unattended by design.

## Constraints

- Guardrails only tighten. This task changes where the rules are enforced, not what they are; a
  rule that turns out to be wrong once it really runs is fixed as its own recorded decision.
- No new runtime dependencies. Build, lint and tests pass at every milestone; coverage only up.

---

## Product decisions already taken

*(reached in #6's `01_product_questions.md` Q7–Q9 before this work was split out; carried here so
the product lap confirms or overturns them rather than rediscovering them)*

| Decision | Choice |
|---|---|
| Refuse-to-start (Q7) | A lap that cannot be guarded does not start. Hard stop, no `--unguarded`. "Nothing was spent" is part of the message |
| Warn-only period (Q8) | None. The landing is softened by the pre-release dry run, not by a mode |
| Disclosure (Q9) | CHANGELOG Security entry; dated line in both security documents; 0.3.0 deprecated on npm; an interim warning until the fix is published |
| ~~Ships alone as a patch from inside #6~~ (Q9) | **Withdrawn** — it needed a mid-cycle merge. Replaced by this task being separate |

**Refusal message, corrected.** The old text cited `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`, which
cannot be emitted once `canUseTool` is no longer passed. The real case is an unverified SDK:

```
Refusing to start the product-review lap: the tool guard has not been verified against the
installed SDK (found 0.3.271, verified 0.3.270). No session was started and nothing was spent.
```

## Design answers carried over

*(reached in #6's design questions and corrected at review on 2026-10-10; input for the design
lap, not settled architecture — each one names what is still unprobed)*

**C1. Transport (was Q1) — unchanged, and confirmed in the SDK source.** Split the rule body into
a transport-neutral `decideToolCall(options)(toolName, input) → GuardDecision`, wrap it in
`createGuardHook`, register it under `hooks.PreToolUse` with no matcher, and **drop `canUseTool`
entirely**: the SDK emits the shadow warning on every session that passes `canUseTool` under
`bypassPermissions`, so keeping it as belt-and-braces would make every session trip its own alarm.
Rule tests call `decideToolCall` directly.

**C2. The lap's tool list (was Q2) — the hook stays the authority; the narrowing mechanism
changes.** Default-deny in the hook for any tool outside the lap's list is the only mechanism
acceptance depends on. For context narrowing use the SDK's **`tools` option** (an allowlist of
built-in tools) with the lap's list, **not** `disallowedTools` computed from a hand-kept
`BUILTIN_TOOLS` constant: a probe session had about thirty tools in context, so a hand-kept
complement will always be behind. Notes:

- `tools` covers built-ins only. MCP tools — including claude.ai connectors, which were present
  even with `settingSources: []` — are stopped by the hook's default-deny. Whether
  `strictMcpConfig: true` also keeps them out of context is unverified; probe it.
- The SDK's own doc for `tools` says native builds may route search through Bash unless `Grep` and
  `Glob` are listed. Review laps must list them explicitly.
- No test may assert security on context narrowing.
- The settings re-grant question (`settingSources: ["project", "user"]` with a
  `permissions.allow: ["Bash"]`) is still settled by a live test, as before.

**C3. Knowing enforcement is installed (was Q3) — three changes.**

1. **Pin the SDK to an exact version** in `package.json` (`"0.3.270"`, no caret). With `^0.3.270`
   a verified-range check is either so narrow it refuses every user who installs tomorrow, or so
   wide it verifies nothing. The pin is stronger than it looks: the SDK pins its per-platform
   binary packages to the same exact version, so this also fixes the executable that honours the
   hook. The runtime check becomes an equality assert (installed === the version the probes ran
   against) that only fires on an `overrides` entry or a hand-linked SDK. Bumping the SDK becomes
   a deliberate act that re-runs the live probes.
2. **The warning listener is a regression canary, not a detection layer.** With `canUseTool` gone
   the SDK cannot emit `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` (it is the only `CLAUDE_SDK_*` warning
   code that exists, and it is gated on `canUseTool` being passed). Keep the listener; describe it
   as "fires if someone reintroduces the shadowed wiring".
3. **The heartbeat compares tool-call ids during the session, not counts at the end.** The hook
   input carries `tool_use_id`; the hook records every id it sees. `runAndStream` checks each
   `tool_result` arriving on the stream against that set and **aborts the session on the first
   result whose call the hook never saw**. The end-of-session count compared after the damage was
   done. Two limits to state honestly: the check can only run on the result, so the one unseen
   call has already executed — the damage is bounded to one call, not zero; and **what the SDK
   does for calls that never reach a real tool is unprobed** — a call to a tool removed from
   context by C2, a subagent's calls, a `server_tool_use`. If any of those produce a result
   without a `PreToolUse` invocation, the heartbeat aborts healthy sessions. Probe all three in
   the live tier before fixing the rule.

**C4. Test tiers (was Q6) — one correction.** Tier 1 (rules via `decideToolCall`), tier 2 (wiring:
`hooks.PreToolUse` present, `canUseTool` absent, the captured hook denies in the SDK's real input
shape, the heartbeat contract) and tier 3 (opt-in live suite, `npm run test:live`) stand. The
global `process.on("warning")` listener in a vitest setup file **cannot fire in tiers 1–2**,
because `query` is mocked and the SDK code that emits the warning never runs. It belongs in the
live tier only; in tiers 1–2 the equivalent protection is the `canUseTool`-is-absent assertion.

# Complete

- [x] Ready to advance to Objective Review
