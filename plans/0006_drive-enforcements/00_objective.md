# Objective

Git belongs to the operator, and a task's cycle belongs to its branch. Nothing merges into
`main` while a task is running — not this task's PR, not another task's — and vibe-racer never
pushes, opens, merges, releases or runs anything on the remote. Task #5 (infinite-loop-fix)
established the pause that makes a human-owned step stoppable; this task closes the three gaps it
left open around git, plus one it created.

It also carries one thing found on 2026-10-10 that comes before all of them: **the tool guard does
not run.** Every rule this task adds to the guard, and every rule the guard already has, is inert
until that is fixed — so it is Milestone 0.

This folds together the three follow-ups #5 carved out — the guard rule (formerly
`0006_guard-enforces-the-no-push-rule`), QA scope after a mid-task merge (formerly
`0007_qa-scope-survives-mid-task-merges`) and `drive` on the task branch (formerly
`0008_drive-operates-on-the-task-branch`) — because they are three consequences of one sentence,
and because the second one dissolves once the first is stated properly. The previous objectives
are reproduced under their milestones below; the folders are deleted.

---

## Why

**The plan lap asks the operator to merge mid-execution.** It has happened on a host project: a
plan contained a step "merge PR into main" between two milestones. The plan prompt teaches this
by example — its gate categories open with "merging a prerequisite PR", the table spec's worked
example is `G1 | Open + merge PRs 0,1,2,9,3 | operator`, and the pause-block example is "Open PRs
against main in order #12 → #14 / Merge both PRs". The only merge the prompt forbids is this
task's *own* PR, and the only enforcement is the trailing-row refusal at sign-off. A gate that
merges someone else's work in the middle of the table is exactly what the prompt asks for.

That is wrong on principle. A task's cycle ends at `done`; the merge is what the operator does
*after* the cycle. Another task's PR is another task's cycle, also not over until its own `done`.
A dependency on unmerged work is therefore a **sequencing decision** — finish and merge that task
first, or base this one on its branch — taken before execution, never a gate row that pauses a
paid lap and sends the operator to `main` to merge something whose QA has not run.

**The no-push rule is prompt-only.** `canUseTool` in `src/claude/guard.ts` does not block
`git push`, `gh pr create` or `gh pr merge`; an execute session that ignored its prompt could push.
`docs/security.md`, `SECURITY.md` and the README all say so under Known Limitations and point at
"follow-up #6" — this task.

**`drive` runs on whatever branch is checked out.** It reads every plan file from the working
tree as it is. From `main` a paused task does not look paused, a ticked resume marker is not seen,
and a session that did start would commit to the wrong branch. #5 worked around it by naming the
task branch in every pause block and printing a branch hint; this task makes the checkout the
pipeline's job.

**QA scope after a gate merge (#7) is closed by construction.** #7 asked how the QA lap could
review a task when part of it had been merged into `main` at a gate and had left
`git diff main...HEAD`. Once no gate may merge, nothing leaves the diff mid-cycle and the
question has no instance. Its four open questions (which scope, where to record it, squash
merges, the coverage statement) are dropped, not answered; the coverage statement the QA prompt
prints today is removed with them.

**Neither security layer is enforced (found 2026-10-10).** `runAndStream`
(`src/claude/session.ts`) starts every session with `permissionMode: "bypassPermissions"` and
passes the guard as `canUseTool`. Under the installed SDK (`@anthropic-ai/claude-agent-sdk`
0.3.270) that mode approves every tool call before the callback is consulted. The SDK says so
itself on every session, as a Node warning with code `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`:

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
stages, `BASH_BLOCKLIST`, the sensitive-path rules, the audit log of denials) never runs, and
Layer 1 does not restrict either: `allowedTools` is an auto-approve list, not a filter on what the
model can call. A review session that "has Read, Glob, Grep, Write" in fact has Bash, Edit and
everything else, kept to its one questions file by the prompt alone. Meanwhile the session log
prints `Guard: path-jail to ./<plan> · tools: [...] · bash: blocked (review stage)`, `init` prints
`Security: canUseTool path-jail enabled`, and `SECURITY.md`, `docs/security.md`,
`docs/how-it-works.md`, `CLAUDE.md` and the README all describe both layers as enforced.

The tests do not catch it: `tests/claude/session.test.ts` mocks `query`, pulls `canUseTool` out of
the options it was called with and invokes it by hand. That proves the callback is passed, not
that anything calls it.

npm `vibe-racer@0.3.0` (published 2026-09-13) has the same wiring and the same SDK range, so the
published package is affected, not only this checkout.

---

## Milestone 0 — The guard actually runs

Before anything is added to the guard, make the guard and the tool list real under the permission
mode the sessions run in.

- **Layer 2 moves to where the SDK consults it.** The decision function in `src/claude/guard.ts`
  stays as it is — same rules, same messages, same audit entries — and is registered as a
  `PreToolUse` hook in `runAndStream` instead of (or as well as) `canUseTool`. Every tool call of
  every guarded session goes through it, including tools that are not in the lap's list.
- **Layer 1 becomes a restriction.** A tool that is not in the lap's list is denied, not merely
  left unlisted. Whether that is done by removing the tool from the model's context
  (`tools` / `disallowedTools`), by a default-deny branch in the hook, or both, is the design
  lap's call; `Skill` keeps its existing allowance when a lap resolves skills.
- **The log line cannot lie.** `formatGuardSummary` and the `init` line are printed only when the
  enforcement they describe is installed, and `init`'s wording no longer names `canUseTool`.
- **A test that would have caught this.** At least one test asserts the wiring the SDK honours
  (the guard is registered under `hooks.PreToolUse` in the options `query` receives, and a tool
  outside the lap's list is denied), and the SDK's `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning is
  treated as a failure, not as log noise. A live-SDK check like the probes above is added if it
  can run without a paid session in CI; if not, it is a documented manual check in the release
  steps.
- **Docs.** `SECURITY.md`, `docs/security.md`, `docs/how-it-works.md`, `CLAUDE.md` and the README
  name the mechanism that is actually used, and the CHANGELOG carries a Security entry saying
  plainly that 0.3.0 did not enforce the guard.

**Acceptance.** In a real session under `bypassPermissions`: a `Write` outside the plan folder at
a review stage is denied and audited; `Bash` at a review stage is denied; a `BASH_BLOCKLIST`
command at `ready_to_execute` is denied; a tool outside the lap's list is denied or absent from
the session's tool list. No session emits `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`. The wiring test
fails if the guard is passed only as `canUseTool`.

---

## Milestone 1 — Plans never ask for a merge

The plan lap loses the ability to plan a merge, and the sign-off refuses one if it slips through.

- **Plan prompt.** "Merging a prerequisite PR" leaves the gate categories. Both worked examples
  (`EXECUTION_TABLE_SPEC`, `PAUSE_BLOCK_SPEC`) become non-merge gates — credentials, a manual
  visual check, an external dashboard, a soak. The rule is stated in words: *no milestone, gate or
  checklist item in this plan merges, pushes, opens or closes a PR, tags, releases or deploys
  anything, this task's or another's. If this task needs work that only exists on another branch
  or in an open PR, that is a dependency: name it under Assumptions & Gaps and in
  `03_plan_questions.md`, and stop planning around it.*
- **Plan review.** The `ai_plan_review` lap checks the plan for dependencies on other branches,
  open PRs or unmerged tasks and raises each as a question in `03_plan_questions.md` with the two
  legitimate answers — sequence this task after the other one, or base it on that branch — so the
  operator decides at `need_plan`, not mid-run.
- **Sign-off refusal.** `signOffPlaybook` (`src/state/advancement.ts`), which already refuses the
  `need_execution` tick on a trailing operator row, also refuses it on any gate row or `## G<n>`
  section whose name or checklist asks to merge, push, open or close a PR, tag, release or deploy
  — naming the row, unticking the box, and saying why in the same voice as the trailing-row
  message. A keyword check, deliberately: a false positive costs one reword, and a hand-written
  playbook goes through the same door.
- **Execute prompt.** Gate verification keeps `git fetch`, `git merge-base` and `gh pr view` as
  read-only checks for the gates that remain (a credential present, a service reachable), and the
  "you never push, open PRs, merge PRs or deploy" rule stays.
- **QA prompt.** The "Operator gates this task paused at" section and the mandatory coverage
  statement go; `qaPrompt` no longer takes a gate list.
- **Docs.** `CLAUDE.md` gains the principle as a Key decision; `docs/how-it-works.md` drops
  "QA's diff scope shrinks after a gate" from the known limitations; `docs/security.md` says a
  plan cannot ask the operator to merge.

**Acceptance.** A plan lap run against a task that depends on an unmerged branch produces a plan
question, not a gate row. A hand-written playbook with `G1 | Merge PR #12 | operator | pending`
followed by `M1` has its sign-off tick refused with the row named. `EXECUTION_TABLE_SPEC`,
`PAUSE_BLOCK_SPEC` and the rendered plan and execute prompts contain no merge, push or PR verb in
any gate example (a test asserts it).

---

## Milestone 2 — The guard enforces the no-push rule

*(formerly `0006_guard-enforces-the-no-push-rule`, unchanged in substance)*

Make "vibe-racer never pushes" a guard rule, not just a prompt rule. Today the rule that an
execute session never pushes, opens or merges a PR, cuts a release or runs a workflow lives only in
`executeMilestonePrompt` and the `radio` role description. The guard does not block any of it.
This milestone depends on Milestone 0: a deny list added to a guard that is never called denies
nothing.

- Add a `ready_to_execute` deny list to the Bash guard for, at minimum: `git push`,
  `gh pr create`, `gh pr merge`, `gh release`, `gh workflow run`. The denial goes through the
  same guard path as the existing `BASH_BLOCKLIST` (the `PreToolUse` hook after Milestone 0) and is written to the audit log like
  every other denial.
- **Hard requirement — the read-only allowances.** `git fetch`, `gh pr view` and `gh pr list`
  must stay allowed. Gate verification runs exactly these to confirm a gate cleared. A deny list
  that catches them breaks every plan with an operator gate: the agent could never verify and the
  fallback ladder would become the only path. Tests cover the allowances as explicitly as the
  denials.
- `docs/security.md`, `SECURITY.md` and the README "Security" section move the rule out of Known
  Limitations, and the blocklist count they all state is updated together (they were corrected to
  agree in #5 M8; keep them agreeing).

**Acceptance.** From a `ready_to_execute` session, each denied command is refused and audited;
each allowed command passes; the three documents agree with `guard.ts`.

---

## Milestone 3 — `drive` operates on the task branch

*(formerly `0008_drive-operates-on-the-task-branch`, unchanged in substance)*

Make `vibe-racer drive` operate on the task's branch regardless of the branch the operator
happens to be on.

- `drive` checks out the task's branch **before** the advancement pass, so the files it reads and
  the tick it looks for are the ones on that branch.
- Decide what happens with a **dirty working tree**: refuse and say what is dirty, stash and
  restore, or commit-on-branch as `commitAll` already does for a task at `done`. The decision is
  written down with its reasoning.
- Decide what happens with **two actionable tasks on different branches** in one `drive`: run
  them one after another with a checkout between, run only the first and name the second, or
  refuse. The decision is written down with its reasoning.
- Restore the operator's original branch afterwards, or say clearly that `drive` leaves them on
  the task branch and why.
- The branch hint `drive` prints when there is nothing to do, and the "switch back to branch"
  closing line in the pause block, are revisited: keep what still helps, drop what the checkout
  makes redundant.

**Acceptance.** With a task paused on `vibe-racer/NNNN_slug` and the operator on `main`, `drive`
finds the ticked resume marker and resumes; a session started by `drive` commits to the task
branch whatever branch was checked out beforehand; the two policy decisions are in
`02_design.md` with their reasoning.

---

## Decisions already made

| Decision | Choice |
|---|---|
| Mid-cycle merges | Forbidden for every task, this one or another's. A dependency is a plan question, never a gate |
| #7 | Closed by construction; its questions dropped, coverage statement removed |
| Enforcement of the merge ban | Prompt **and** deterministic sign-off refusal; a keyword check is acceptable because the cost of a false positive is one reword |
| Guard scope | `ready_to_execute` Bash only; `radio` stays prompt-only and the declaration keeps saying so |
| Milestone order | 0, then 1, then 2, then 3 — nothing the guard promises is true until 0 lands, and 2 is built on it; the prompt fix stops the next planned task from producing the row; the guard rule is mechanical; the checkout carries the design decisions |
| Guard mechanism | A `PreToolUse` hook, which the SDK consults under `bypassPermissions` (probed). The rules in `guard.ts` do not change in Milestone 0 — only where they are called from |
| Task number | Keeps #6: the three shipped security documents already point at "follow-up #6" for the guard rule |

## Open questions for the product and design laps

1. The sign-off refusal's verb list: what is in it, and is "close a PR" or "tag" a false positive
   worth tolerating?
2. Should the plan-review dependency check also look at `git branch --contains` / open PRs on the
   host repo, or only at what the plan text says?
3. Milestone 3's two policies (dirty tree, multiple tasks) — proposal: refuse with the dirty paths
   named; run only the first actionable task and name the rest.
4. Does the pause block's closing line still name the branch after milestone 3, as a courtesy, or
   does it go?

5. Milestone 0: is a tool outside the lap's list removed from the model's context, denied by the
   hook, or both? And does `settingSources: ["project", "user"]` let a settings file re-grant what
   the lap's list withholds?
6. Milestone 0: the guard's rules have never run against a real session under this SDK. Which of
   them deny something the laps legitimately do today, and is that found by a dry run before
   release or by the first real race?
7. Milestone 0: does it ship on its own as a patch release ahead of milestones 1–3, and what do
   the 0.3.0 documents say in the meantime?

## Out of scope

- A `depends_on` precondition (`new --after 0004`, `drive` refusing to start execution until the
  dependency's branch is an ancestor of `main`). The structural answer to sequencing, but a new
  feature with its own questions about `new` and `pitwall`. Recorded in `plans/backlog.md`.
- `radio`, which spawns the operator's own interactive `claude` CLI where the guard does not
  run, before or after Milestone 0.
- Leaving `bypassPermissions` for another permission mode. The sessions are unattended by design;
  the fix is to enforce inside that mode, not to start prompting.
- Any other stage's Bash rules; changing when QA runs; pushing, pulling, rebasing or merging any
  branch from `drive`; creating the task branch (already the first `drive`'s job).

## Constraints

- Guardrails only tighten. Nothing here grants a tool, relaxes the path jail or lets an agent
  push. Milestone 0 changes where the rules are enforced, not what they are; a rule that turns out
  to be wrong once it really runs is fixed as its own recorded decision, not loosened in passing.
- `state.yml` stays pipeline-owned; the agent signals through plan files only.
- Backward compatible with in-flight tasks: an existing playbook with a non-merge gate still
  signs off and executes; one with a merge gate is refused with the row named, not silently
  skipped.
- No new runtime dependencies. Build, lint and tests pass at every milestone; coverage only up.

# Complete

- [x] Ready to advance to Objective Review
