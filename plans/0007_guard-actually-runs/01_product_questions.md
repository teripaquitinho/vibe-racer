# Product Questions for #7: guard-actually-runs

> **Role**: Senior Product Designer
> **Stage**: `ai_objective_review` → `need_product`
> **Date**: 2026-10-12

---

The objective already carries four product decisions taken in #6 (Q7–Q9) and asks this lap to
confirm or overturn them rather than rediscover them. Q1 and Q6 below do that work. Q2–Q5 are the
decisions this task opens that #6 never had to make, because until now the guard never fired: once
it really runs, **denials, aborts and refusals become things users see**, and none of them have a
designed shape yet.

---

## Refusing to race

### Q1: What exactly makes a lap unguardable, and is the hard stop still the right call?

#6's Q7 settled "a lap that cannot be guarded does not start — hard stop, no `--unguarded`", and
the objective's corrected refusal message names exactly one trigger: an SDK version that is not
the pinned, probed one. But "cannot be guarded" is broader than that in practice — the hook could
fail to register, `.vibe-racer/audit.log` could be unwritable (read-only mount, permissions), or
the config could resolve a lap with an empty tool list. Which of these stop the lap, and does a
user hitting the SDK mismatch have a way out other than reinstalling?

**Answer:**
Confirm the hard stop, no `--unguarded`, no env-var escape. Three triggers refuse, checked in this
order before any session starts:

1. **SDK version mismatch** — installed SDK ≠ the pinned probed version. This is the common case
   and is almost always caused by an `overrides` entry or a hand-linked SDK.
2. **Hook not registered** — the options object vibe-racer is about to pass has no
   `hooks.PreToolUse` entry. A paranoid self-check, cheap, and catches a future refactor that
   silently drops it.
3. **Audit log unwritable** — the denial record is part of the guarantee the docs make; a guard
   that denies without recording is a weaker product than one that refuses to start. Probe by
   opening the file for append and closing it at refusal-check time, not with a `stat` — and
   without writing an entry, so a lap with no denials leaves the log untouched (Q7).

Every refusal message carries three things, in this order: **what is wrong**, **that nothing was
spent** (keep this — it is the line that stops a user retrying in a panic), and **the one concrete
command that fixes it**. The SDK case does **not** tell the user to install the SDK: vibe-racer is
a globally installed CLI, the SDK lives inside its own install, and
`npm install @anthropic-ai/claude-agent-sdk@…` run in the user's project would add a package to
*their* repository and change nothing. The message names the two real causes and their fixes —
reinstall vibe-racer (`npm install -g vibe-racer@<this version>`), or, when vibe-racer is a
dependency of a project with an `overrides` entry for the SDK, remove that entry — with a pointer
to the docs section explaining the pin. The audit-log case names the path it could not write. A user who genuinely wants an unguarded agent already has one — `claude` directly — and
the refusal should say so in one clause rather than pretend the need does not exist.

Exit code is non-zero, and the task's `state.yml` is **not** moved to `error`: nothing was
attempted, so the task stays exactly where it was and `drive` works again once the SDK is fixed.

### Q2: When the guard denies a tool call mid-lap, what does the user see?

Denials currently call `log.warn` and append to the audit log — written for a guard that never
fired. Now a review lap that tries one `Bash` call will print a warning in the middle of streaming
session output, and a confused agent may retry the same call five times. Is a raw warning per
denial the right surface, or does the lap need a consolidated report?

**Answer:**
Both, at different volumes. Keep **one warning line per denial** inline in the stream — it is the
only thing that explains why the agent just changed course, and hiding it would make laps look
like they stalled for no reason. Keep the existing `Denied: <tool> <input> — <reason>` shape; users
have no history with it, so there is nothing to preserve, but it is already the right three fields.

Add a **denial summary at the end of every guarded lap**, printed whether the lap succeeded or
not: a count, the distinct `(tool, reason)` pairs with how many times each fired, and the audit log
path. One block, no per-call repetition. A lap with zero denials prints nothing — silence is the
signal that the normal case is clean, and a "0 denials" line on every lap trains users to ignore
the whole surface.

**Repeated identical denials are collapsed inline**: print the first in full, then suppress
duplicates of the same `(tool, reason)` pair and let the end-of-lap summary carry the count. An
agent that retries a blocked `Bash` eight times should cost eight audit entries and one screenful,
not eight.

Explicitly **not** in scope for this task: a `vibe-racer audit` command to read the log. The path
in the summary is enough; a reader is a follow-up once we know whether anyone opens the file.

### Q3: A heartbeat abort kills a session mid-lap. What state does the task land in, and what happens to the work already done?

C3 specifies aborting on the first `tool_result` whose call the hook never saw, and states honestly
that the one unseen call has already executed. So an abort means: an unguarded tool call happened,
and the session is being killed with partial work on disk — possibly a half-written document, or
a half-finished milestone during execute. From the user's side this is the scariest thing in the
task. What should it do?

**Answer:**
Treat it as a **security incident, not a retryable failure**. On abort:

- Move the task to **`error`**, with a message that distinguishes it from an ordinary session
  failure: a tool call bypassed the guard, which tool it was, and that the lap was stopped
  mid-flight.
- **Do not commit, and do not roll back.** vibe-racer's existing promise is one commit per lap;
  an aborted lap has no lap to commit. Leaving the partial work in the working tree (uncommitted,
  visible in `git status`) is the honest state — the user can `git diff` to see exactly what the
  session did, including what the unguarded call did, and `git checkout` it themselves. Silently
  reverting would destroy the only evidence of the bypass.
- **`drive --retry` must refuse this error state specifically.** Every other `error` is retryable;
  this one means the enforcement mechanism is not behaving as probed, so retrying just spends money
  to bypass the guard again. The message tells the user to report it, names the audit log and the
  dirty working tree as the two artefacts to attach, and says the retry is blocked deliberately.

**The way out, because a blocked retry with no exit is a dead end.** `state.yml` is
pipeline-owned, so "edit it by hand" cannot be the answer. The handler records two things with the
error: that it is a guard bypass, and the vibe-racer version that hit it. `drive --retry` on that
task then refuses **until both** of these hold, and says which one is missing:

1. **the installed vibe-racer is a different version** from the one recorded — the mechanism that
   failed has been replaced, which is the only thing that makes a retry more than a repeat;
2. **the working tree is clean** — the user has looked at what the aborted session left and has
   committed or discarded it. Otherwise the retried lap's commit would sweep the bypassed call's
   output in with its own (`commitAll` stages everything).

If no fixed version exists yet, the task waits. That is the real cost of this design, stated
rather than softened — and it is why the probe below is a blocking prerequisite: an abort must be
rare enough that waiting for a release is an acceptable answer to it.

Record the abort in the audit log too, as its own entry type — it belongs in the same file as the
denials, since both answer "what did the guard do on this task".

One consequence to accept deliberately: C3 flags three unprobed cases (context-removed tools,
subagent calls, `server_tool_use`) that could make the heartbeat abort healthy sessions. Given this
design, a false abort is expensive — it errors a task and blocks its retry. **The live-tier probe
of all three is a blocking prerequisite for shipping the heartbeat**, not a nice-to-have: if any
one of them produces a result without a `PreToolUse` invocation and the rule cannot be narrowed to
exclude it, the heartbeat ships **in warning-only form** (print, audit, do not abort) and the
abort behaviour becomes its own task. The guard itself — the part acceptance depends on — ships
either way.

---

## The dry run, and what it is allowed to change

### Q4: The pre-release dry run will find rules that block legitimate agent work. Does the rule loosen, the prompt change, or does the task stop?

The objective's constraint says "guardrails only tighten — a rule that turns out to be wrong once
it really runs is fixed as its own recorded decision", while the dry-run step says each denial is
recorded as "correct-and-prompt-fixed or wrong-and-rule-fixed". Those two sentences disagree about
whether this task may loosen a rule. The dry run is the first time these rules have ever executed,
so finding at least one over-broad rule is the expected outcome, not the exception. Which way does
it resolve?

**Answer:**
Resolve it in favour of shipping, with a bright line: **this task may narrow a rule only where the
rule blocks a lap from completing its own documented job, and every such narrowing is recorded in
`05_qa.md` with the denial that motivated it.** It may not broaden what any lap can reach beyond
that lap's documented job, and it may not remove a rule.

Concretely, the three outcomes available per denial in the dry run:

| Outcome | When | What ships |
|---|---|---|
| **correct-and-prompt-fixed** | The rule is right; the agent should not have tried | Prompt or skill change, rule untouched. The preferred outcome — prefer it whenever both would work |
| **correct-and-gate-row** | The rule is right and the step genuinely must happen | Nothing changes; the step becomes an `Owner = operator` gate row at plan time. Uses machinery that already exists |
| **wrong-and-rule-narrowed** | The lap cannot do its documented job at all | Minimal narrowing, recorded with the denial, the lap, and why the other two outcomes did not apply |

A denial that needs a narrowing **larger than one lap's documented job** — anything that would
re-open the project root at a review stage, or unblock `Bash` wholesale — stops being this task's
business: it ships as a recorded `05_qa.md` finding and its own follow-up, and this task ships with
the tight rule. That is the "its own recorded decision" the constraint asks for, and it means a
surprising dry run delays a rule fix, never the disclosure.

**This amends a constraint the objective states**, and the operator confirms it by ticking this
file: the objective says a wrong rule "is fixed as its own recorded decision", which read strictly
means never in this task. The answer above allows one narrow case inside it. If that is not
wanted, strike the third row of the table: the dry run then has two outcomes, and a lap that
cannot do its job under the live guard blocks the release until a follow-up task lands.

**Who runs it, and where it sits in the plan.** The dry run is seven real, paid sessions against a
throwaway task. An execute session cannot start them — it has no business spawning `drive`, and
the spend is the operator's. So it is planned, not improvised:

| Row | Owner | What happens |
|---|---|---|
| …the milestones that build the guard… | agent | |
| **Gate — dry run** | operator | In a scratch repository, with this branch's build linked, race a throwaway task through all seven laps. Leave the resulting `.vibe-racer/audit.log` and one line per lap (completed / could not complete) where the next milestone can read them |
| **Classify and fix** | agent | Every denial in that log is put in one of the three rows above; prompt fixes and any narrowing are made here, each recorded with the denial that motivated it |
| **Gate — re-run what changed** | operator | Re-race only the laps whose prompt or rule the previous row changed. If none changed, the checklist says so and is ticked without a run. A narrowing that has not been seen to work under the live guard is not shipped on its author's word |
| **Record the result** | agent | The final per-lap table, written where the QA lap reads it for `05_qa.md` |

Both gates are followed by the milestone they unblock, and neither merges, pushes or releases
anything — they are checks of the kind the plan prompt allows. One round of re-run is planned; a
second failure is not another row, it is a pause (`needs_operator`) and a conversation.

**The dry run's pass bar**, so this is not judged by feel: every lap completed its own document
once, under the live guard, with every denial classified into one of the three rows above and none
left unexplained. A lap that cannot complete is a blocker, not a note.

---

## Telling people

### Q5: Confirm the disclosure shape — and where does the interim warning live, and who takes it down?

#6's Q9 settled: CHANGELOG Security entry, a dated line in both security documents, `npm deprecate`
on 0.3.0, and "an interim warning until the fix is published". The first three have obvious homes.
The interim warning does not: it is the thing a user trialling the current npm release needs to
see, and the objective says they should be told to treat a `drive` session as an unrestricted agent
in the repo. Where does it go, and what guarantees it is removed rather than becoming permanent
furniture?

**Answer:**
Confirm all four channels of Q9 as settled. The interim warning goes in **exactly two places**,
both editable without a release:

1. **A short admonition at the top of the README's Security section** (not the top of the README —
   it is a wiring bug in a released version, not a reason to scare off every reader at line one),
   naming 0.3.0, what it means in one sentence, and the version that fixes it once that exists.
2. **The GitHub issue #7 thread**, as the canonical public record, with the probe table from the
   objective. Users who search the symptom land there.

Not in `drive`'s own output: a user running the fixed version does not need a warning about the
version they are not running, and a user running 0.3.0 will never get the new code that prints it.
That is the trap worth naming explicitly — **nothing shipped in this task can warn a 0.3.0 user**,
which is why `npm deprecate` carries the weight and must not be skipped.

Removal is made structural rather than remembered — **but not as a row in the Execution Status
table.** A post-`done` release step is never a row: the objective says so of merge, publish and
`npm deprecate`, and the sign-off refuses a plan whose table ends in an operator row with nothing
after it. The structure comes from where the two edits live instead:

- **The interim admonition goes onto `main` now, by the operator, outside the pipeline** — a
  one-paragraph README edit, not a task. It has to be on `main` to be seen at all, and it cannot
  wait for this task's cycle.
- **This task's branch replaces it.** One of its milestones rewrites that same README paragraph
  into the permanent wording (the dated line, the mechanism actually used). So merging the task
  *is* the removal: there is no version of `main` that has the fix and still carries the interim
  warning.
- The merge will conflict on that one paragraph, since `main` changed it after the branch was
  cut. That is expected, and it is resolved in favour of the branch. Say so in the `done` lap's
  decision document so it is not a surprise at merge time.

Honest wording on the dated line in both security documents, matching what the objective
establishes: **"0.3.0 did not enforce the tool guard; earlier versions are unverified."** Do not
write "never enforced since 0.1.0" — it was not probed. Do not write "a bug in 0.3.0 only" either,
which implies earlier versions were fine.

### Q6: Does the surface where the guard still does not run get an explicit warning — and what happens to tasks already mid-pipeline?

Two gaps survive this task by design. `radio` is out of scope and has never been guarded, so after
this ships, `drive` is genuinely guarded and `radio` is genuinely not — and today's README mentions
that in a paragraph a reader can miss. Separately, a user with tasks sitting at `ready_to_execute`
who upgrades will find that the next `drive` denies things the previous laps on the same task were
allowed to do. Do either of these need user-facing treatment, or are they documentation-only?

**Answer:**
**`radio` gets a one-line notice when it starts**, printed before the interactive session opens:
that this is the user's own `claude` CLI, that the guard does not apply, and that nothing here is
restricted. It is cheap, it is true today and after this task, and it is the single place where a
user's mental model of "vibe-racer sessions are guarded" is wrong at exactly the moment it matters.
No prompt, no confirmation — `radio` is explicitly interactive and attended; a user sitting at a
prompt they asked for should not be asked to confirm it. Keep the README's existing "two things the
guard does not do" paragraph and update its second half, since #6 is what closes the push gap.

**Mid-pipeline tasks need no migration and no warning.** Every command re-reads state from disk and
every lap is independent, so an in-flight task simply gets a guarded next lap. The upgrade story is
"the guard starts working", which is the fix, not a breaking change. Say so in one CHANGELOG line
rather than building anything.

The one real edge case to handle: a task whose earlier laps wrote files outside the plan folder
that a later guarded lap now cannot touch. That surfaces as an ordinary denial with an ordinary
reason, goes through the Q2 summary, and is resolved by Q4's classification like any other. No
special-casing, no grandfathering — grandfathering is how a guard stops being a guard.

---

## What the guard writes and what it withholds — added at the `need_product` review, 2026-10-12

> Two gaps the six questions above do not cover. Both were invisible while the guard never fired.
> The answers are proposals for the operator to confirm or rewrite.

### Q7: The audit log is about to exist for the first time. Where does it live, and can it end up in a commit?

`docs/configuration.md` and `docs/faq.md` both say `.vibe-racer/` is gitignored. Nothing in the
code makes that true: `init` writes no ignore rule, and this repository's own `.gitignore` lists
`.viberacer/` — without the hyphen — so `.vibe-racer/audit.log` is not ignored here either. It has
not mattered, because a guard that never denies never writes the file. From this task on, every
denial appends a line holding the denied command or path, and every lap ends in `commitAll`, which
stages everything. And the log has a 1 MB cap past which entries are dropped silently — while Q1
makes "a denial that is not recorded" a reason to refuse a lap.

**Answer:**
The audit log is **local evidence, never committed, and never silently incomplete.**

- **`.vibe-racer/` ignores itself.** Whenever vibe-racer creates that directory it also writes
  `.vibe-racer/.gitignore` containing `*`. No edit to the user's own `.gitignore`, no dependence on
  `init` having run, and it covers projects initialised before this release the first time a
  guarded lap starts. The two documents that already say "gitignored" become true rather than
  being reworded.
- **A tracked audit log is a refusal, not a cleanup.** If `.vibe-racer/audit.log` is already
  tracked by git when a lap starts, the lap does not start; the message gives the one command
  (`git rm --cached .vibe-racer/audit.log`). vibe-racer does not untrack a file on the user's
  behalf.
- **The cap rotates instead of dropping.** At 1 MB the file is renamed to `audit.log.1`
  (replacing any earlier one) and a fresh `audit.log` starts. Bounded at two files, and no entry
  is ever discarded without a trace. If the rotation itself fails, that is Q1's "audit log
  unwritable" and the lap refuses.
- **This repository's own `.gitignore` is corrected** (`.viberacer/` → `.vibe-racer/`), and its
  stale `.viberacer-secrets` line is checked against what the secret scanner actually reads.
- **What the log may contain is said in `docs/security.md`:** denied commands and paths, verbatim.
  It can hold something sensitive the agent tried to run. That is acceptable for a local,
  ignored file and is the reason it must stay one — and the reason the Q2 summary prints the
  path, never the entries, when output might be pasted into an issue.

### Q8: The per-lap tool lists were written when they restricted nothing. What is actually in them once they do?

Review laps list `Read, Glob, Grep, Write`; execute and cleanup add `Edit, Bash`; QA adds `Bash`.
Under default-deny, everything else is refused — and a session under this SDK is offered about
thirty tools: subagents (`Task`), `WebFetch`/`WebSearch`, `ToolSearch`, the background-task
companions (`TaskOutput`, `TaskStop`), scheduling and messaging tools, and every MCP tool the
user's settings or claude.ai connectors bring in. Nobody chose to deny those; the lists simply
never mentioned them. Q4 forbids broadening a lap's reach after the dry run, so the baseline has
to be decided before it, not discovered by it.

**Answer:**
Decide the baseline now, by one principle: **a tool is in a lap's list only if it has no reach of
its own beyond what the lap is already allowed.**

| Tool family | Decision | Why |
|---|---|---|
| The current lists | **Unchanged.** | They are the documented job of each lap |
| `Skill` | Unchanged: allowed when the lap resolved skills | Existing allowance. A skill that tells the agent to use a tool outside the lap's list gets an ordinary denial; the denial message says the tool is not available at this stage, so the cause is legible |
| Subagents (`Task`) | **Denied at every stage** | Whether the hook sees a subagent's tool calls is one of the three unprobed cases (Q3). Until it is probed, a subagent is a way to act where the guard may not be looking. Revisit only with that probe in hand |
| `WebFetch`, `WebSearch` | **Denied at every stage** | Network access. The Bash blocklist already denies `curl` and `wget`; allowing the same reach through another tool would make that rule decorative |
| MCP tools, claude.ai connectors included | **Denied at every stage** | Unbounded, user-specific reach — a connector can write to a document, a tracker, a chat. This is a **visible change** for anyone whose laps were quietly using one, and gets its own CHANGELOG line under Changed |
| Scheduling, messaging, remote and worktree tools | **Denied at every stage** | No lap's job involves them |
| `TaskOutput`, `TaskStop`, `ToolSearch` | **Candidates, decided by the dry run** | No reach of their own: the first two only read or stop a background `Bash` the lap already started, the third only loads tool descriptions. If the dry run shows a lap stalling without one, adding it where its parent tool is already allowed is the *only* list change Q4's third row may make. Anything not on this line is a follow-up task |

Two consequences to state rather than leave implicit:

- **No config key to extend a lap's list in this task.** A `tools:` override in `.vibe-racer.yml`
  is a real feature request the MCP denial will generate. It is a follow-up with its own
  questions (which laps, which tools, what the banner then says), not a switch added in passing
  to a task whose point is that the lists finally mean something.
- **The `Guard:` banner prints the list that is enforced**, which after this task is the same
  thing as the list that is offered. If the design narrows the session's context to the lap's
  list, a denial for an out-of-list tool should be rare; when it does happen it is counted in the
  Q2 summary like any other.

---

# Complete

- [x] Ready to advance to Product Review
