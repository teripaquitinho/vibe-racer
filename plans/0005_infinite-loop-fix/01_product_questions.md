# Product Questions for #5: infinite-loop-fix

> **Role**: Senior Product Designer
> **Stage**: `ai_objective_review` → `need_product`
> **Date**: 2026-09-21

---

**Review notes.** The objective is clear and unusually complete; this is not a trivial task (new
pause stage, new operator workflow, changed sign-off experience), so it takes the full pipeline.
The decisions in "Decisions already made" are treated as settled and are not re-asked here. One
discrepancy to be aware of: the objective says the spec lives at `plans/execute_infinite_loop_bug.md`
(`plans/` root), but the file is actually at `plans/0005_infinite-loop-fix/execute_infinite_loop_bug.md`.
Acceptance criterion 11 should be read as "delete the spec wherever it lives" — I assume the task
folder copy is the only one.

The questions below cover the objective's six open questions, reframed where the product
behaviour behind them needed sharpening.

---

## Sign-off experience

### Q1: Where does the operator see the gates *before* they tick the box?

The objective says that at `need_execution`, "advancement lists the operator gates the plan
contains". But advancement only runs when the operator runs `drive` — which is *after* they have
already ticked "Ready to advance to Execution". A terminal log at that point is a receipt, not a
warning. Should the gate list also live in `04_execute.md` itself, above the checkbox, so the
operator reads it at the moment of signing? And should gates use a distinct ID prefix (`G1`) or
milestone-style numbering (`M9a`)?

**Answer:**
Both surfaces, with the file as the primary one.

- **In the file (primary):** the plan lap writes an "Operator gates" summary section in
  `04_execute.md`, placed directly above the "# Complete" checkbox. It lists each gate by ID, its
  one-line name, and which milestone it sits in front of (e.g. "G1 — Open + merge PRs 0,1,2,9,3 —
  before M9"), and states plainly: "Execution will pause at each of these and wait for you." If the
  plan has no gates, the section says "None — execution runs start to finish without you." An
  explicit "none" is a promise the operator can hold the plan to.
- **In the terminal (secondary):** when `drive` advances past `need_execution`, it prints the same
  list as a confirmation ("This plan contains 2 operator gates: G1, G2"). It does not block or ask
  for a second confirmation — the tick is the consent.
- **Gate IDs:** `G<n>`, numbered independently of milestones (G1, G2, …). Gates must be
  recognisable at a glance in the table, logs and `pitwall`; `M9a` reads as agent work and
  renumbers awkwardly when milestones change.

---

## Pausing

### Q2: What counts as a stall, and how many sessions before an undeclared stall pauses?

The objective proposes pausing after two sessions that "change nothing". But "nothing" is
ambiguous from the operator's point of view: a session can commit real code and still not finish
the milestone (max turns, a large milestone, a flaky test). Is that a stall? And is the threshold
2 or 1, and is it configurable?

**Answer:**
- **Definition:** a stall is judged on the milestone's row in the Execution Status table, nothing
  else. After a session, if the current milestone is not `done` and not `needs_operator`, that
  session counts as a stall — whether or not it committed code. Progress on the *row* is the only
  thing that resets the counter. This keeps the rule explainable in one sentence: "two sessions on
  the same milestone without finishing it, and I stop and ask you."
- **Threshold:** 2. One retry absorbs a flaky or max-turns session; a second identical outcome is
  a pattern, not bad luck. Worst-case waste per stall is one paid session, which is acceptable
  against the current unbounded loss.
- **No configuration key in v1.** Not in `.vibe-racer.yml`, not as a CLI flag. If nobody asks for
  it, it never needs to exist.
- **The pause block must say which kind of stall it was**, because the operator's next move
  differs: "The agent made no changes in 2 sessions" (usually an undeclared human-owned step —
  read the agent's message below) versus "The agent committed work in 2 sessions but did not
  finish M4" (usually an oversized milestone — review the commits, then resume or split the
  milestone). In both cases the agent's final message from the last session is included verbatim.
- **Terminal output while it happens** must be honest: show the milestone ID, the attempt number
  and the remaining count (e.g. "Executing M9 (attempt 2/2, 9 remaining)"), and never report an
  empty commit as success.

### Q3: What does the operator get when the pause was *not* planned, and what are their ways out?

For a planned gate, the checklist comes from the plan and is concrete. For an unplanned pause (the
agent declares `needs_operator`, or stalls silently), the quality of the instructions depends on
what the agent wrote. What is the minimum the operator is guaranteed to see in `04_execute.md`,
and what can they legitimately do besides "do the work and tick the boxes" — e.g. decide the
milestone is unnecessary, or that the agent was wrong?

**Answer:**
- **Guaranteed minimum in every pause block**, regardless of cause: (1) which milestone or gate
  paused and why, in one sentence; (2) a checklist with at least one actionable item; (3) what the
  agent will check on resume, or "nothing — the agent will simply retry" if there is no
  verification; (4) the resume marker; (5) one closing line: "When done, tick every box above and
  run `vibe-racer drive`." An operator who never saw the terminal must be able to act on the block
  alone (acceptance criterion 10).
- **Agent-declared pause:** the agent's own checklist is used as written. If it declared
  `needs_operator` but wrote no block, the pipeline writes one from the agent's final message.
- **Silent stall:** the block contains the agent's final message verbatim under "What the agent
  said", plus a single generic checklist item: "Resolve the issue described above (or edit the
  milestone in the Execution Status table)". We do not try to turn prose into a multi-item
  checklist — a wrong checklist is worse than an honest generic one.
- **Supported ways out**, all documented in the pause block's closing lines and in
  `docs/how-it-works.md`:
  1. *Do the work* — tick the items, tick the marker, `drive`.
  2. *Overrule the agent* ("this step is fine, try again") — tick the items and the marker without
     doing anything; the agent retries, and if it hits the same wall the task pauses again after
     one session. Bounded, never a loop.
  3. *Skip or rewrite the milestone* — the operator edits the Execution Status table by hand
     (mark the row `done`, or reword the milestone), then ticks and resumes. The table is the
     operator's file as much as the agent's; hand edits are a supported escape hatch, not a hack.
- **No new "abandon task" command** in this task. Abandoning is whatever it is today.

---

## Resuming

### Q4: Who verifies that a gate really cleared, and what happens when it did not?

On resume, something has to confirm the operator's work actually landed (PRs really merged, deploy
really out). The objective offers agent-side verification (simple, costs a session) or
pipeline-side verification (free and deterministic, but the plan must emit runnable checks). Which
for v1, and what does the operator experience when they ticked too early?

**Answer:**
- **Agent-side in v1.** The next agent milestone starts by running the read-only verification the
  plan recorded for the gate. No pipeline-side command execution in this task — that turns plan
  text into commands the pipeline runs on the operator's machine, which is a trust decision that
  deserves its own task.
- **Ticked too early:** the agent finds the gate unmet, declares `needs_operator`, and the task
  pauses again after that one session with a *new* numbered pause block. The new block must say
  explicitly that this is a re-pause and what the verification found (e.g. "Pause 2 (G1 again):
  verification failed — `feat/pr3-brand-tokens` is not an ancestor of `origin/main`"). Cost: one
  session. The operator should never have to diff two blocks to understand why they are back.
- **Gates with nothing checkable** (a visual check, "wait 24h for the soak") carry the
  verification line "None — operator's word". The pipeline trusts the tick. We do not invent fake
  verifications for human judgement calls.
- **Incomplete tick:** if the resume marker is ticked but checklist items are not, `drive` unticks
  the marker, lists the outstanding items in the terminal, and leaves the task paused — same feel
  as `need_decision` today. No session is started.
- **Resume is seamless:** a correctly ticked block resumes execution in the same `drive`
  invocation. The operator never has to run `drive` twice.

### Q5: How does a paused task look in `pitwall`, `drive` and `radio`?

A paused task is a new kind of "waiting on human": it is mid-lap, not between laps. How should it
be presented so it is not mistaken for an ordinary pit stop or for an error, and should `radio`
work while paused?

**Answer:**
- **`pitwall`:** a separate "Waiting on operator" group, listed *above* the ordinary pit-stop
  group because it blocks a lap that was already paid for. Each entry shows task number and
  title, the paused milestone/gate ID, the one-line reason, and the file to edit
  (`plans/NNNN_slug/04_execute.md`). Example:
  `#16 unify-ui-brand-style — paused at G1: PRs 0,1,2,9,3 not merged → edit 04_execute.md`.
- **`drive`:** at the moment of pausing, prints a pit-board message: what paused, the checklist
  items, and the resume instruction. On a later `drive` with the task still paused and unticked,
  it lists the task under the same "waiting on operator" wording with the reason and file — it
  does not start a session and does not treat it as an error. `--retry` does not touch paused
  tasks; it remains for `error` only.
- **Tone:** a pause is the pipeline working as designed. Neutral/amber presentation, never the red
  error styling, and the words "error" or "failed" never appear for a pause.
- **`radio`: yes, enabled at `need_operator`,** with the Software Engineer persona (the same voice
  that ran the lap). An operator stuck on a gate will want to ask "what exactly did you need from
  PR 3?" or "can this milestone be reworded so you can do it?". Radio at this stage is
  conversational and may help the operator edit the playbook, but it follows the same rules as
  the execute lap: it never pushes, opens PRs, merges or deploys, and it cannot resume the task —
  only the operator's tick does that.

---

## Scope edges

### Q6: What happens to existing playbooks, and does the guard learn the no-push rule in this task?

Two boundary calls. (a) Tasks already in flight have playbooks with no Owner column and possibly
`blocked` rows — is silent backward compatibility enough, or should the operator be told their
playbook cannot express gates? (b) "vibe-racer never pushes" is today only a prompt rule; the
guard does not block `git push`, `gh pr create` or `gh pr merge`. Tightening it is compatible with
"guardrails stay as they are" in spirit, but is it part of this fix?

**Answer:**
- **(a) No migration, no warning on every run.** Rows without an Owner column are treated as
  agent-owned; `plans/0001`–`0004` keep parsing and rendering in `pitwall` exactly as today. A
  per-`drive` warning on old playbooks would be noise the operator cannot act on. Instead, old
  playbooks are protected by the run-time safety net: an undeclared human-owned step pauses after
  two sessions like any other stall. Only in that situation — a stall pause on a playbook with no
  Owner column — the pause block adds one line: "This playbook predates operator gates; add a
  gate row to the Execution Status table if this step is yours." Legacy `blocked` rows pause
  rather than skip, and the pause block says "marked `blocked` by an earlier run" so the operator
  understands why a task that used to sail past now stops. A playbook whose status table cannot
  be read sends the task to `error` with a message naming the file and what was expected (a
  Milestone and a Status column under "Execution Status") — never a silent jump to QA.
- **(b) Out of this task; ship separately and soon.** This fix is about giving a refusal
  somewhere to go, and its acceptance criteria are all provable without touching the guard.
  Bundling a guard change widens the blast radius of a bug fix and muddies the "guardrails
  unchanged" promise in the changelog. The execute prompt *does* gain the explicit
  no-push / no-PR / no-deploy rule in this task (already in scope). Guard enforcement becomes its
  own follow-up task, created right after this one lands, with the read-only allowances
  (`git fetch`, `gh pr view`, `gh pr list`) called out as a requirement so gate verification
  keeps working.

---

# Complete

- [ ] Ready to advance to Product Review
