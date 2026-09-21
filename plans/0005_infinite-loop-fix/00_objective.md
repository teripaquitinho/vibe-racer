# Objective

Make the execute lap stop instead of spin. When vibe-racer reaches a step it must not or cannot
do — open a PR, merge, deploy, wait for a review or a soak, click through a screenshot check — it
must pause the task, record in `state.yml` that the execute lap needs the operator, and write into
`04_execute.md` exactly what the operator has to do. Steps a human owns must already be marked as
such when the operator signs the plan off at `need_execution`, not discovered mid-run.

The guardrails stay exactly as they are. The bug is not that the agent refuses; the bug is that the
pipeline has nowhere to put a refusal, so it retries it forever.

**`plans/execute_infinite_loop_bug.md` (repo, `plans/` root) is the spec for this task.** It holds
the root-cause analysis with file and line references, the proposed design, the file-by-file change
list, and the test list. Treat it as the primary input, and delete it once this work lands.

---

## Why

**It has happened twice.** Most recently on host task `0016_unify-ui-brand-style`: milestone M9 was
gated on PRs 0, 1, 2, 9 and 3 being merged into `main`. None was open. Every session did the right
thing — changed no files, left the guardrails alone, printed precise unblock instructions — and
`handleExecute` immediately started another session on the same milestone. It ran until a human
noticed. Every iteration is a full paid SDK session that produces nothing.

**The loop has one exit and it is a regex count.** `src/pipeline/handlers/execute.ts:21-45` is
`while (true)`, broken only by `countPendingMilestones(content) === 0`. It never compares the status
table before and after a session, never caps attempts, and discards the session's final message —
the very text that told the operator how to unblock. `milestone++` counts sessions rather than
milestones, and `commitAll` returning nothing is logged as "agent already committed", so the stall
reads like progress.

**The agent has no legal way to say "not mine".** `executeMilestonePrompt` offers two outcomes:
finish the milestone, or "adapt the implementation but keep the same goals". `blocked` exists as a
status in the plan prompt but is never mentioned to the executor and means nothing to the handler.
So the agent refuses in prose and leaves the table untouched — precisely the state the loop cannot
detect.

**The plan lap cannot express a human-owned step.** It asks for milestones "running continuously
without pausing", so gates become prose between rows ("M9 can't start until PRs … are merged"),
never rows in the status table. The operator ticking the box at `need_execution` never sees the
list of actions they owe, and the handler sees M9 as ordinary agent work.

**Two silent siblings share the root cause** — the handler trusts a count and nothing else:

- A milestone marked `blocked` drops out of the count, so the loop moves on to milestones that
  depend on it and, once every row is `done` or `blocked`, advances the task to `ai_qa` as if
  execution had finished.
- A status table the regex cannot parse (different casing, an emoji status such as `⏸ paused`, a
  renamed column) counts as zero pending on the first read, so the task goes straight to `ai_qa`
  with nothing executed.

---

## Target behaviour

### 1. Operator steps are marked at sign-off

The plan lap gains the notion of a step vibe-racer does not perform. The Execution Status table in
`04_execute.md` gets an **Owner** column (`agent` | `operator`), and every action outside
vibe-racer's reach becomes its own gate row rather than prose: push, open or merge a PR, code
review, deploy, manual visual or screenshot checks, soak or waiting periods, credentials, external
services. Each gate row gets a matching checklist in `03_plan.md` and a read-only verification the
next agent milestone runs to confirm the gate actually cleared.

```
| Milestone | Name                       | Owner    | Status  | Commit | Notes |
| M8        | Brand tokens               | agent    | done    | a1b2c3 |       |
| G1        | Open + merge PRs 0,1,2,9,3 | operator | pending |        | gate  |
| M9        | Storybook                  | agent    | pending |        |       |
```

At `need_execution`, advancement lists the operator gates the plan contains, so the person ticking
"Ready to advance to Execution" sees what they are signing up for.

### 2. A step that cannot be executed pauses the task

New pause stage `need_operator`, modelled on `error`: outside the linear `STAGE_ORDER`, always
returning to `ready_to_execute`, with `paused_stage`, `operator_reason` and `operator_milestone`
recorded in `state.yml`. It is a detour, not a failure — `--retry` on `error` would walk straight
back into the same wall.

The execute loop parses the Execution Status table instead of counting regex hits, and:

- **a gate row owned by the operator pauses before any session starts** — zero cost;
- **a milestone the agent marks `needs_operator` pauses after that one session**;
- **a session that changes nothing pauses after at most two sessions**, carrying the agent's final
  message into `04_execute.md` so its explanation is not lost;
- **a hard cap on total sessions per `drive`** guarantees termination even if the parser is wrong.

`state.yml` is pipeline-owned, so the handler writes the pause; the agent only signals it through
the status table and the playbook.

### 3. What to do is written where the operator is already looking

Each pause appends a numbered block to `04_execute.md`: why it paused, a `- [ ]` checklist of
concrete actions, the verification the agent will run on resume, and a resume marker. The operator
does the work, ticks every item plus the marker, and runs `drive`; execution resumes at the paused
milestone, re-verifies the gate, and continues. A gate ticked too early costs one session and
pauses again — bounded, never a loop.

The resume marker deliberately does **not** read `Ready to advance …`: `04_execute.md` already
carries the ticked "Ready to advance to Execution" from sign-off, and sharing the marker would
resume the task instantly — the stale-tick failure that issue #3 fixed. The
"one questions file per stage" invariant therefore becomes injectivity on the `(file, marker)`
pair, and that has to be stated in `CLAUDE.md` and pinned by a test.

---

## Decisions already made

| Decision | Choice |
|---|---|
| Pause mechanism | New `need_operator` stage, outside `STAGE_ORDER`, returning to `ready_to_execute` |
| Reuse `error`? | No — `error` means broken, and `--retry` would re-enter the same wall |
| Where the instructions live | `04_execute.md`, one numbered block per pause; only the latest block counts |
| Resume marker | Distinct text, not `Ready to advance …` |
| `blocked` status | Removed; legacy `blocked` rows parse as `needs_operator` and pause rather than skip |
| Unparseable status table | Throws (task goes to `error`); never counts as "nothing pending" |
| Guardrails | Unchanged. Nothing in this task loosens the guard |

---

## Open questions for the product and design laps

1. **How many sessions before an undeclared stall pauses?** Proposal: 2, so one flaky or
   max-turns session gets a retry. 1 is cheaper. No `.vibe-racer.yml` key in v1 unless the design
   lap argues for one.
2. **Who runs the resume verification?** Agent-side (proposed for v1, simple, costs a session) or
   handler-side (deterministic and free, but the plan must emit machine-runnable checks).
3. **Gate row IDs:** a distinct prefix (`G1`) or milestone-style numbering (`M9a`)? Proposal: `G<n>`,
   so gates are visible at a glance in logs and tables.
4. **Should `radio` work at `need_operator`?** `CHAT_PERSONA_MAP` has no entry for it. An operator
   stuck on a gate may well want to talk it through.
5. **Do old playbooks need a migration?** Rows without an Owner column default to `agent`, so
   `plans/0001`–`0004` keep parsing — confirm that is enough, or whether `drive` should warn that a
   pre-Owner playbook cannot express gates.
6. **Should the guard enforce the no-push rule?** Today "vibe-racer never pushes" lives only in
   prompts; `guard.ts` does not block `git push`, `gh pr create` or `gh pr merge`. Blocking them at
   `ready_to_execute` (while leaving `git fetch`, `gh pr view`, `gh pr list` allowed for gate
   verification) would tighten, not loosen, the guardrails — but it is separable from this fix.
   In or out?

---

## Scope boundaries

**In scope**

- `need_operator` stage: schema fields, `writeState` prev/next handling, pause helper in `store.ts`
- `handleExecute` rewritten around a real status-table parser: stall detection, attempt cap,
  per-`drive` session backstop, pause path, honest logging
- `parseExecutionStatus` / `setMilestoneStatus` / operator-block helpers in `validation.ts`, plus the
  two latent bugs (`blocked` skipping work, unparseable table advancing to QA)
- Resume path in `advancement.ts`, including checklist enforcement and the distinct resume marker
- Plan prompt: Owner column, operator gate rows, per-gate checklists and verifications
- Execute prompt: the `needs_operator` protocol, the explicit no-push / no-PR / no-deploy rule, and
  gate verification before dependent milestones
- `drive` and `pitwall`: a "waiting on operator" group showing the reason and the file to edit
- Docs: `CLAUDE.md`, `docs/how-it-works.md` (its "Execution Loop" section is already out of date —
  it describes one session and checkboxes, not one session per milestone against a status table),
  `CHANGELOG.md`
- Tests, starting with the reported case: an unchanged table must pause, never loop

**Out of scope**

- Automating the operator's work: vibe-racer still never pushes, opens PRs, merges or deploys
- Guard changes (open question 6 — decide, then ship separately if yes)
- Parallel or out-of-order milestone execution; the lap stays strictly sequential
- Retry or backoff policy for genuine session errors — that is `error` plus `--retry`, unchanged
- Anything in `backlog.md`

---

## Constraints

- **Guardrails do not move.** No new tool permissions, no relaxed path jail, no agent-initiated
  pushes or PRs.
- **`state.yml` stays pipeline-owned.** The agent signals through `04_execute.md`; the handler
  writes the stage.
- **Termination is structural, not prompt-dependent.** The loop must be bounded even if the agent
  ignores every instruction and the parser misreads the table.
- **Backward compatible with in-flight tasks.** Playbooks without an Owner column still execute;
  `plans/0001`–`0004` still parse and render in `pitwall`.
- **Nothing the agent explained is thrown away.** A pause always records why, in the operator's file.
- No new runtime dependencies. Build, lint and tests pass at every milestone.

---

## Acceptance criteria

1. **The reported case cannot recur:** with a session that leaves the status table unchanged, the
   handler runs at most the configured number of attempts, then sets `stage: need_operator` and
   writes the agent's final message into `04_execute.md`. Proven by a test that would hang on
   today's code.
2. A milestone marked `needs_operator` by the agent pauses after exactly one session.
3. A first-unfinished row with `Owner = operator` pauses with `runAndStream` never called.
4. Progress resets the stall counter: M1 done then M2 stalling pauses at M2, not at M1.
5. Ticking the resume checklist and running `drive` resumes execution at the paused milestone in the
   same invocation; an unticked item unticks the resume marker and lists what is outstanding.
6. A ticked "Ready to advance to Execution", or a ticked resume marker in an *earlier* pause block,
   does not resume a current pause.
7. A milestone marked `blocked` in a legacy playbook pauses instead of being skipped; a playbook with
   no parsable status table errors instead of advancing to `ai_qa`.
8. At `need_execution`, advancement names the operator gates the plan contains.
9. `pitwall` and `drive` show paused tasks as waiting on the operator, with the reason and the file
   to edit.
10. `04_execute.md` for a paused task tells an operator who was not watching the run exactly what to
    do and how to resume, with no terminal scrollback needed.
11. `CLAUDE.md` states the `(file, marker)` injectivity invariant, a test enforces it, and
    `plans/execute_infinite_loop_bug.md` is deleted.

---

# Complete

- [x] Ready to advance to Objective Review
