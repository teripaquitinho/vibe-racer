# Product Questions for #4: Add QA step

> **Role**: Senior Product Designer
> **Stage**: `ai_objective_review` → `need_product`
> **Date**: 2026-08-24

---

## Operator flow between execution and QA

### Q1: Does `drive` automatically chain from execution into QA, or must the operator invoke `drive` a second time?

Right now the operator runs `drive`, execution completes, and the task parks at `fine_tuning`. With the new QA lap inserted between execution and fine-tuning, the question is whether execution's completion should seamlessly kick off the QA session in the same invocation, or whether the operator sees "execution complete" and must run `drive` again to get QA.

Chaining is smoother but blurs the boundary — a QA failure is harder to retry independently, and the operator loses the natural pause where they could inspect execution output before QA begins. Stopping is one extra `drive` but keeps every stage independently retriable.

**Answer:**
Do not chain. Execution ends, commits, and parks the task at `ai_qa`. The operator must run `drive` again to start the QA session. This preserves the principle that each `drive` invocation dispatches exactly one handler, keeps QA independently retriable on failure, and gives the operator a natural moment to inspect execution output before QA runs. The `drive` command should print a clear hint: `Task #4 is ready for QA — run 'vibe-racer drive' to start the QA lap.`

---

## Decision checklist enforcement

### Q2: Should `need_decision` refuse to advance if individual checklist items in `06_decision.md` are still unticked?

Today `tryAdvance` only checks for the final completion checkbox (`- [x] Ready to advance to ...`) and that all `**Answer:**` blocks are filled. An operator could tick the final box with half the post-deploy checklist still unchecked. This is the only stage in the pipeline where there is a meaningful list of items above the completion checkbox that the operator is expected to work through individually.

**Answer:**
Yes, enforce it. `tryAdvance` should verify that every `- [ ]` checkbox in `06_decision.md` is ticked before accepting the completion marker. The decision checklist is the entire point of the stage — letting the operator skip items defeats its purpose. If the operator genuinely wants to close with unticked items, they can delete the line or replace it with a note explaining why it was skipped. This teaches `validation.ts` one new rule (all checkboxes ticked in the decision file), scoped only to `need_decision` — no other stage's behavior changes.

---

## Trivial tasks and QA

### Q3: Do trivial tasks skip QA and the decision stage, or do they get a lightweight version?

Trivial tasks currently skip product and design laps, going straight from objective review to plan questions. The question is whether they should also skip QA and decision (objective → plan → execute → cleanup → done), or whether even a small change deserves verification and a close-out gate.

**Answer:**
Trivial tasks skip both QA and decision. The trivial fast-path exists because small, bounded changes do not warrant the full ceremony. QA's value comes from catching gaps between a complex plan and its implementation — a trivial task has a thin plan and a narrow diff, so the QA lap would mostly parrot "everything looks fine." The existing cleanup pass (build, lint, tests) is sufficient verification for trivial scope. The pipeline for trivial tasks remains: objective → plan → execute → cleanup → done.

---

## Pipeline naming and the racing metaphor

### Q4: Should QA and decision be presented as "laps" (making it a seven-lap race), or as a distinct post-race phase?

The README, docs, and tagline all say "five laps." Changing to seven inflates the headline number and dilutes the metaphor — seven laps feels bureaucratic rather than fast. But calling them something else introduces a second concept the operator has to learn. The racing domain offers natural analogues: scrutineering (post-race technical inspection) and parc fermé (the controlled area where results are confirmed).

**Answer:**
Keep calling them laps and update the headline to seven. The metaphor is already loose — "pit stops" between laps is not how real F1 works either — so consistency matters more than fidelity. Operators already understand "lap = a phase of work." Introducing a parallel concept like "scrutineering" adds cognitive overhead for no practical gain. Update the tagline, README, and docs to say seven laps. The two new laps are Lap 6 (QA) and Lap 7 (Decision). Simple, sequential, no new vocabulary.

---

## QA findings and the operator's response

### Q5: When QA surfaces problems, what is the operator's workflow for addressing them before advancing?

The QA lap will sometimes report genuine issues — unmet acceptance criteria, regressions, half-built features. The objective explicitly excludes automated remediation loops, so the operator must fix things manually. But the current pipeline has no formal mechanism for "go back and fix, then re-run QA." The operator's options need to be clear: do they use `radio` to make fixes during `fine_tuning`, then re-run QA? Or do they fix during `fine_tuning` and advance without re-verifying?

**Answer:**
The operator uses `radio` at the `fine_tuning` pit stop to make fixes, then advances to `cleanup_ready`. There is no "re-run QA" loop — that is explicitly out of scope, and introducing it would complicate the linear state machine. The workflow is: (1) QA writes `05_qa.md` with findings, (2) operator reads findings at `fine_tuning`, (3) operator uses `radio` to fix issues, (4) operator ticks the checkbox to advance, (5) the cleanup session (which already runs build/lint/tests) serves as the re-verification pass. If the operator wants a fresh QA opinion after significant fixes, they can reset the task to `ai_qa` using the existing `--retry` mechanism — but this is a power-user escape hatch, not the default flow.

---

## Radio personas at new stages

### Q6: What persona and capabilities should `radio` offer at `fine_tuning` (post-QA) and `need_decision`?

`radio` provides a conversational chat with the race engineer at any pit stop. It uses `CHAT_PERSONA_MAP` and `CHAT_ROLE_DESCRIPTIONS` to tailor the chat to the current stage. The two stages that need new entries are `fine_tuning` (which exists but its description currently refers to post-execution tweaking, not post-QA fixing) and `need_decision` (entirely new). The persona should match what the operator needs help with at each stage.

**Answer:**
At `fine_tuning`, update the persona to a **Senior QA Engineer** who has read `05_qa.md` and can help the operator understand and fix the issues found. The role description should reference the QA findings and guide the operator through addressing them — not just "tweak execution output." At `need_decision`, the persona should be a **Release Manager** who has read `06_decision.md` and can help the operator work through the post-deploy checklist — explaining what to verify, suggesting how to check each item, and helping the operator decide whether an item can be waived. Both personas should have access to the full plan directory for context.

---

# Complete

- [ ] Ready to advance to Product Review
