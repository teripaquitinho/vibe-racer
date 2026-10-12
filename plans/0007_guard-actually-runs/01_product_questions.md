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
   that denies without recording is a weaker product than one that refuses to start. Probe with a
   real append at refusal-check time, not a `stat`.

Every refusal message carries three things, in this order: **what is wrong**, **that nothing was
spent** (keep this — it is the line that stops a user retrying in a panic), and **the one concrete
command that fixes it**. The SDK case ends with `npm install @anthropic-ai/claude-agent-sdk@<pinned>`
and a pointer to the docs section explaining the pin. The audit-log case names the path it could
not write. A user who genuinely wants an unguarded agent already has one — `claude` directly — and
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

Removal is made structural rather than remembered: the README admonition is a **row in this task's
own Execution Status table as an `Owner = operator` gate**, in the post-`done` release sequence
alongside the deprecate call. It is not a "remember to clean up later" note.

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

# Complete

- [ ] Ready to advance to Product Review
