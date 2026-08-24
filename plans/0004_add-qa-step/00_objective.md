# Objective

Extend the race from five laps to seven: add a **QA lap** after execution and a **decision lap**
that gates task closure behind a post-deploy checklist. Along the way, make every lap draw on the
engineering skills installed in the operator's Claude account, and close the `state.yml` corruption
hole documented in `vibe-racer-fix.md`.

Three workstreams ship together because they touch the same files (`src/state/schema.ts`,
`src/pipeline/states.ts`, `src/claude/prompts.ts`, `src/claude/guard.ts`). Splitting them would
mean three rounds of conflicting edits to the stage enum and the prompt module.

---

## Why

**The pipeline has no verification lap.** Execution ends when the last milestone flips to `done` in
`04_execute.md` — which only means the agent believed it finished. `cleanup_ready` runs build, lint,
and tests, but that is a smoke check bolted onto a docs pass, not a QA review. Nothing produces an
honest account of what actually works, what is half-built, and what regressed. The operator finds
out after merge.

**The pipeline has no close-out gate.** A task goes `done` the moment the cleanup session commits.
There is no record of what has to be true *after deploy* before the work can be considered
delivered, and no place for the operator to confirm it was.

**The laps don't use the skills the operator has.** Sessions run with
`settingSources: ["project"]` and an `allowedTools` list that omits `Skill`, so account-level
engineering skills are invisible to the race engineer. Every lap re-derives from a persona string
what a skill already encodes.

**A live bug lets the agent corrupt its own control file.** Documented in full in
`vibe-racer-fix.md` (found on mosaic task #5, 2026-07-21). The review agent wrote `state.yml`
itself, guessed `next: ai_plan` — not a valid stage — and the recovery path died re-reading the
same poisoned file. Adding stages to the enum makes this strictly worse: more values for an agent
to guess wrong. It has to be fixed in the same change.

---

## Workstream A — Close the `state.yml` corruption hole

Fold in the three fixes specified in `vibe-racer-fix.md` (repo root). That document contains the
full root-cause analysis, the git evidence, and the proposed patches — treat it as the spec for
this workstream and delete it once the work lands.

Summarized:

1. **Deny agent writes to `state.yml` at every stage.** New guard rule in `src/claude/guard.ts`,
   placed *before* the existing review-stage rule (Rule 4) so it also covers execution, QA, and
   cleanup stages, which have `Write`/`Edit` in their allowed tools. This is the load-bearing fix:
   `state.yml` currently sits inside the agent's write sandbox because it lives in the task plan
   directory the review stages are jailed to.
2. **Make `setError` survive an unparseable state file.** `src/state/store.ts` — `setError` opens
   with `readState`, so the corruption it exists to record is the thing that kills it. Salvage
   `title`/`created` when possible, write a valid `stage: error` record when not.
3. **Validate on write, not only on read.** `writeState` serialises unchecked, so bad state
   surfaces at the next read rather than at the write that caused it. Diagnostic hardening, not the
   fix — note that on its own it would not have prevented the incident.

**Conflict to resolve:** the objective-review prompt currently *instructs* the agent to write
`state.yml` when it detects a trivial task (`src/claude/prompts.ts`, "If trivial" section, steps
1–2). Once the guard rule lands, that instruction becomes an instruction to trigger a denial. The
trivial fast-path must be re-plumbed so the pipeline sets `trivial: true`, not the agent — e.g. the
agent signals triviality through an artifact the handler reads (writing `03_plan_questions.md`
instead of `01_product_questions.md` is already an unambiguous signal), and `objective-review.ts`
calls into `store.ts` to set the flag.

---

## Workstream B — Engineering skills in every lap

Make the race engineer able to invoke the engineering skills installed on the operator's Claude
account, and have each lap's prompt reference the ones relevant to that lap.

Three things are currently in the way, all in `src/claude/session.ts` and the handlers:

- `settingSources: ["project"]` excludes user-scope settings, where account skills resolve from.
- `Skill` is not in any handler's `ALLOWED_TOOLS`, so the tool cannot be called.
- The tool guard has no notion of `Skill` — it falls through to default-allow, which is probably
  right, but should be a deliberate decision rather than an accident.

**Wiring (decided):** ship built-in per-lap defaults, overridable per-lap in `.vibe-racer.yml`.
Defaults keep vibe-racer working for someone who just installed it; the override keeps it useful
for a team with its own skill library. Shape to be settled in the design lap, roughly:

```yaml
skills:
  objective: [...]
  product:   [...]
  design:    [...]
  plan:      [...]
  execute:   [...]
  qa:        [...]
  decision:  [...]
```

**Open — the default skill names are not yet known.** The operator's engineering skills live in
their Claude account, not on disk (`~/.claude/skills/` does not exist; the only local plugin is
`frontend-design`). The product lap must start by enumerating what is actually installed and
mapping each lap to the skills that fit it. Do not hardcode guessed names.

**Degradation matters.** A configured skill that the operator does not have must not fail the lap.
Missing skills should warn at load and be dropped from the prompt, not abort the race.

---

## Workstream C — The QA lap and the decision lap

### Target state machine

```
need_objective   -> ai_objective_review
need_product     -> ai_product_review
need_design      -> ai_design_review
need_plan        -> ai_plan_review
need_execution   -> ready_to_execute      (milestone loop, unchanged)
                 -> ai_qa                 NEW  — writes 05_qa.md
                 -> fine_tuning                 — human edits QA, ticks the box
                 -> cleanup_ready               — docs pass + writes 06_decision.md
                 -> need_decision         NEW  — human works the post-deploy checklist
                 -> done
```

Two new stages: `ai_qa` (agent) and `need_decision` (human). `STAGES` is positional —
`STAGE_ORDER` indexes it — so insertion order is the mechanism and the regression test from
`vibe-racer-fix.md` (`nextStage("need_plan") === "ai_plan_review"`) guards against reordering
mistakes.

### Lap 6 — QA (`ai_qa` → `05_qa.md`)

Runs when the milestone loop in `handleExecute` drains. Performs a thorough review of the work
actually produced — using the engineering review skills from Workstream B — and writes an honest
assessment to `05_qa.md`.

The document must cover, at minimum:

- **What works** — verified against the plan's acceptance criteria, with evidence (test names,
  commands run, output). Not "milestone 3 says done."
- **What doesn't** — gaps between what `03_plan.md` specified and what was built, bugs found,
  acceptance criteria not met.
- **What regressed** — behavior that worked before this task and does not now.
- **Deviations** — where execution departed from the plan, and whether the departure was sound.
- **Risks and known limitations** — carried into the decision checklist.
- **Verification run** — build, lint, tests, with actual results pasted, not summarized.

The QA session must be honest about failure. A QA lap that reports everything as fine is worse than
no QA lap, because it launders an unverified result into a verified-looking one. The prompt has to
push against the model's pull toward agreeable summaries — this is a first-class prompt-design
problem for the design lap, not a footnote.

`05_qa.md` ends with the pit-stop checkbox. It carries the checkbox that `04_execute.md` carries
today, so `STAGE_QUESTIONS_FILE[fine_tuning]` moves from `04_execute.md` to `05_qa.md`, and
`handleExecute` stops rewriting the execution playbook's checkbox.

### Pit stop — operator adjusts QA (`fine_tuning`)

Unchanged in kind: the operator reads `05_qa.md`, corrects anything the race engineer got wrong,
and may use `vibe-racer radio` to make small fixes. Manual for now — automated remediation loops
are explicitly out of scope. Ticking `- [x] Ready to advance to Cleanup` advances the task.

**Decided:** keep the existing `Ready to advance to <Name>` checkbox convention rather than a bare
"Ready to cleanup". Every pit stop in the pipeline reads the same way, and `CHECKED_MARKER` /
`removeCompletionMarker` in `src/pipeline/validation.ts` need no change.

### Lap 7 — Decision (`cleanup_ready` → `06_decision.md`, then `need_decision`)

The existing cleanup session (docs pass, build/lint/test) also writes `06_decision.md`: a
checklist of everything that must be verified **after deploy** before the task can be closed.

Derived from the actual work, not a boilerplate template. Drawn from `00_objective.md`'s intent,
`03_plan.md`'s acceptance criteria, and — importantly — the risks and known limitations recorded in
`05_qa.md`. Every item must be concretely checkable: what to look at, where, and what "good" looks
like.

The task then parks at `need_decision`. The operator deploys, works the checklist, ticks the items,
and ticks the final completion checkbox. The next `vibe-racer drive` moves the task to `done`.

---

## Decisions already made

| Decision | Choice |
|---|---|
| Skills wiring | Built-in per-lap defaults, overridable in `.vibe-racer.yml` |
| After `06_decision.md` | New human `need_decision` stage gates `done` |
| Checkbox wording | Keep `Ready to advance to <Name>` |

---

## Open questions for the product and design laps

1. **Which engineering skills, per lap?** Blocking for Workstream B. Enumerate what is installed on
   the account before proposing a mapping.
2. **Does `handleExecute` chain into QA, or stop?** `drive` dispatches one handler per invocation.
   If execute advances to `ai_qa` and returns, the operator must run `drive` again to get QA — a
   quiet extra step right where they expect the lap to end. If execute chains, the two stages blur
   and a QA failure is harder to retry independently.
3. **Should `need_decision` refuse to advance while checklist items are unticked?** `tryAdvance`
   only checks the completion marker and `**Answer:**` blocks, so today an operator could tick the
   final box with half the checklist unticked. Enforcing it means teaching `validation.ts` about
   checklist completeness.
4. **Is `ai_qa` a `REVIEW_STAGE`?** Jailing its writes to the plan directory is right — QA must not
   fix what it is judging. But QA needs `Bash` to run tests, and `formatGuardSummary` currently
   prints `bash: blocked (review stage)` for every review stage, which would be a lie. Either the
   summary becomes tool-aware or `ai_qa` gets its own guard treatment.
5. **What does the trivial fast-path do with QA?** Trivial tasks skip product and design. Do they
   also skip QA and decision, or is a lightweight QA exactly what a small change deserves?
6. **Seven laps, or five laps plus a checkered flag?** Product-facing naming. README, docs site,
   `docs/pipeline.md`, and the tagline all say five. The racing metaphor may want QA and decision
   framed as something other than laps — scrutineering and the post-race sign-off, say — rather
   than inflating the headline number.
7. **What happens to `radio` at the two new stages?** `CHAT_PERSONA_MAP` and
   `CHAT_ROLE_DESCRIPTIONS` in `prompts.ts` need entries for `need_decision`, and `fine_tuning`'s
   role description still describes the old post-execution tweaking stage.

---

## Scope boundaries

**In scope**

- Two new stages, their handlers, prompts, and guard treatment
- `05_qa.md` and `06_decision.md` generation
- Per-lap skill configuration, defaults, and prompt integration across all seven laps
- The three fixes from `vibe-racer-fix.md`, plus re-plumbing the trivial fast-path around the new
  guard rule
- Updates to `pitwall` stage display, `drive`'s waiting-on-human hints, `radio` personas
- Docs: `README.md`, `CLAUDE.md`, `docs/pipeline.md`, `docs/how-it-works.md`,
  `docs/commands.md`, `docs/configuration.md`, `CHANGELOG.md`
- Regression tests, including the three named in `vibe-racer-fix.md`

**Out of scope**

- Automated remediation of QA findings — the operator fixes things manually via `radio`
- Any form of deploy automation; `06_decision.md` is a checklist the human works, and vibe-racer
  never learns whether the deploy happened
- Re-running QA in a loop until clean
- Changes to the existing five laps' outputs beyond skill references in their prompts
- The local web dashboard and everything else in `backlog.md`

---

## Constraints

- **`state.yml` is pipeline-owned.** After this change, no prompt may instruct an agent to write it,
  and no handler may rely on an agent having written it.
- **Backward compatibility with in-flight tasks.** Existing `state.yml` files carry `next:` values
  computed under the old stage order — a task sitting at `ready_to_execute` has `next: fine_tuning`
  on disk, which will be wrong once `ai_qa` is inserted. `next` is recomputed on every write, so
  this self-heals, but tasks in `plans/0001`–`0003` must still parse and `pitwall` must still render
  them.
- **No new runtime dependencies** unless the design lap justifies one explicitly.
- **Skills degrade gracefully** — a missing skill warns, it does not fail the lap.
- Build, lint, and tests pass at every milestone.

---

## Acceptance criteria

1. A task driven end to end produces seven documents, `00_objective.md` through `06_decision.md`,
   and reaches `done` only after the operator ticks the decision checkbox.
2. `05_qa.md` reports at least one honest negative finding on a task where something is genuinely
   incomplete — verified by seeding a task with a deliberately unmet acceptance criterion.
3. `06_decision.md` items trace to the objective, the plan's acceptance criteria, and the risks
   recorded in `05_qa.md`.
4. An agent `Write` or `Edit` targeting `state.yml` is denied at a review stage, an execution stage,
   and the new QA stage, and the denial is recorded in `.vibe-racer/audit.log`.
5. `setError` on a plan directory whose `state.yml` is unparseable writes a valid `stage: error`
   record instead of throwing.
6. The trivial fast-path still works without the agent writing `state.yml`.
7. Configured skills appear in the relevant lap's prompt; an unconfigured or missing skill produces
   a warning and a lap that still completes.
8. `pitwall` renders both new stages; `drive` names the right file and checkbox for each.
9. Docs describe the full pipeline with no stale five-lap references, and `vibe-racer-fix.md` is
   deleted from the repo root.

---

# Complete

- [x] Ready to advance to Objective Review
