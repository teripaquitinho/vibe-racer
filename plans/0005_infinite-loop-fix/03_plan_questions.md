# Plan Questions for #5: infinite-loop-fix

> **Role**: Senior Software Engineer
> **Stage**: `ai_design_review` → `need_plan`
> **Date**: 2026-09-21

---

**Scope note.** Architecture is settled in `02_design.md` and product in `01_product.md`; neither
is re-opened here. These six questions pin **how this gets built**: the milestone order and the
one ordering that is not negotiable, the dogfooding hazard (vibe-racer executes itself with the
code this task is changing), how the AC1 "would hang today" claim is actually evidenced, where
the parser fixtures come from, whether the E17 `drive` reorder lands here, and where the docs and
security-declaration work sit.

---

## Build sequence

### Q1: What are the milestones, and in what order do they land?

`02_design.md` touches thirteen source files across five layers (`pipeline`, `state`, `claude`,
`git`, `cli`). The plan lap has to turn that into
milestones small enough for one session each, every one ending green. There is an obvious
temptation to lead with `handleExecute` — it is the bug — and an obvious risk in doing so. What
is the milestone list and its ordering rule?

**Answer:**
Eight milestones, ordered by one rule: **everything that consumes `need_operator` lands before
the only thing that produces it.**

| # | Milestone | Files | Ends green because |
|---|---|---|---|
| M1 | Table contract + parser | `src/pipeline/execute-table.ts`, `tests/pipeline/execute-table.test.ts`, `tests/fixtures/playbooks/` | Pure module, no callers yet |
| M2 | Pause-block format | `src/pipeline/operator-block.ts`, `tests/pipeline/operator-block.test.ts` | Pure module, no callers yet |
| M3 | State layer **+ resume path** | `schema.ts`, `states.ts`, `store.ts`, `discovery.ts`, `advancement.ts`, **`cli/drive.ts` (call-site fix only)** + their tests | The `(file, markerText)` map change lands with all three call sites — `advancement.ts:24`, `drive.ts:100-101`, `states.test.ts:95-103` — in the same commit |
| M4 | Operator surfaces | `cli/drive.ts`, `cli/pitwall.ts` + tests | The operator-group output — M3 already fixed drive's call site. Reads `Task.operator*`; inert until something pauses |
| M5 | **The loop** — `decideNextStep`, `foldOutcome`, driver, `repoSnapshot`/`currentBranch` | `handlers/execute.ts`, `git/operations.ts` + tests | First and only producer of `need_operator`; **AC1 test lands here** |
| M6 | Prompts | `claude/prompts.ts`, `handlers/qa.ts` + `prompts.test.ts` (incl. the contract test) | Plan / execute / qa / chat prompts + `EXECUTION_TABLE_SPEC` interpolation |
| M7 | Docs + housekeeping | `CLAUDE.md`, `docs/how-it-works.md`, `CHANGELOG.md`, delete `execute_infinite_loop_bug.md`, create the follow-up tasks | AC20 |
| M8 | Security declaration review | `docs/security.md`, `SECURITY.md`, `README.md` — **docs only, no code** | AC22 |

**M3 before M5 is not negotiable** — but TypeScript, not discipline, enforces that half of it.
M5 cannot compile without M3: `pauseForOperator` lives in `store.ts`, and `"needs_operator"` is
not a `Stage` until `schema.ts` grows it. Landing M5 first is not a thing that can happen.

**The hazard worth naming is the one the compiler does not catch: a split M3.** M3 lands two
changes that look separable and are not — the `STAGE_QUESTIONS_FILE.need_operator` entry
(`states.ts`) and the `need_operator` delegation at the top of `tryAdvance` (`advancement.ts`,
design §7.1). Land the map entry without the delegation and every paused task takes the *generic*
path: it finds the ticked "Ready to advance to Execution" left over from sign-off, passes
`validateAnswers` vacuously (a playbook has no `**Answer:**` markers, so nothing is unanswered),
gets `null` from `nextStage("need_operator")` — and `tryAdvance` returns `advanced: true` anyway,
because `advancement.ts:59-64` guards the `updateStage` call with that `null` but not the return.
A false success on every `drive`, forever, and the same class of hazard as `plans/0004`'s
"M2 before M3". So: **the map entry and the delegation go in one commit**, and M3 also hardens the
generic path to return `advanced: false` when `nextStage` yields `null` (design §7.1), which
closes the hazard class rather than stepping around it.

The mirror-image failure is worth knowing too, because it is quieter. If `stage: need_operator`
ever reaches `state.yml` before `schema.ts` knows the stage, `stateSchema.parse` rejects the file
and `discoverTasks` swallows it in its bare `catch` (`discovery.ts:42-44`) — the task disappears
from `pitwall` and `drive` entirely, with no error anywhere. Because vibe-racer executes itself,
neither window is hypothetical (Q2).

M4 before M5 for the cheaper version of the same reason: a paused task landing before the CLI
knows about pauses shows as a bare `[need_operator]` with no reason and no marker hint. Cost of
the ordering: zero.

M6 after M1 (it interpolates `EXECUTION_TABLE_SPEC`). M8 strictly last, after all code has
landed, so it describes the code as shipped (§12).

---

### Q2: vibe-racer executes this task with the code this task is changing. How is that handled?

M5 replaces the loop that is running this very task — but not at the moment it commits, and that
is the part worth pinning. `handleExecute` is a `while (true)` inside a single Node process that
imported the module at startup, and the installed CLI runs `dist/`, not `src/`; committing a
rewritten `handlers/execute.ts` mid-run changes nothing for the run in flight. Whenever the
cutover does happen, it happens against `plans/0005_infinite-loop-fix/04_execute.md` — a playbook
written by the **old** plan prompt, so it has no Owner column. A bug in M5 does not fail a test;
it bricks the task's own execution. When does the cutover actually happen, and what is the
protocol?

**Answer:**
Treat M5 as a live cutover and plan for it explicitly rather than discovering it.

1. **The cutover is an explicit step with two owners, and only one of them is the agent.**
   Nothing changes when M5 commits: the process still holds the old bundle, so M6–M8 go on being
   driven by the old regex loop — the very bug this task exists to remove — and the live AC13
   exercise never happens. Splitting the steps by who can actually perform them:

   | Step | Owner | Note |
   |---|---|---|
   | `npm run build` | **M5 agent** (last item in its task list) | The agent has `Bash`. This is load-bearing: `vibe-racer` on this machine is an `npm link` — `/opt/homebrew/bin/vibe-racer` → `<repo>/dist/index.js` — so the build overwrites the exact bundle the running CLI was loaded from |
   | Commit M5 | pipeline | The driver's own `commitAll` |
   | **Ctrl-C** | **operator, at the terminal** | The agent session is a *child* of the `drive` process; it cannot interrupt its own parent. This step can never be an agent task |
   | `git status`, discard partial M6 work | **operator** | See below — the interrupt lands mid-session, not in a gap |
   | `vibe-racer drive` | **operator** | New bundle, new loop, M6 onward |

   **There is no quiet gap to interrupt in.** `execute.ts:38-43` runs `commitAll` → `readFile` →
   build prompt → `log.info("Executing milestone 6 …")` → `runAndStream`, with nothing in
   between: sub-second. So the Ctrl-C lands *inside* the M6 session, which may already have
   edited files. That is why the discard step exists and is not optional — without it the
   restarted loop runs M6 on top of uncommitted partial M6 work. State is safe either way
   (`ready_to_execute`, M6's row still `pending`); it is the working tree that needs the sweep.
   The operator's cue is the `Executing milestone 6` line itself.

   **If the operator misses the window, nothing is broken** — M6–M8 simply complete under the old
   loop, which handles them fine (the table is well-formed and none of them pause) and the live
   AC13 exercise is the only thing lost. Say so in `04_execute.md`'s M5 row, so the interrupt
   reads as a deliberate, skippable choice rather than a crash or a mandatory agent step.
   *Corollary:* M1–M5 themselves all run under the old, unbounded loop regardless. If one of them
   stalls, point 3 is the only way out.
2. **Immediately before that cutover, a dry read — not a dry run:** once the code lands and the
   suite is green, parse this task's own `04_execute.md` with the new parser in a scratch script and
   assert the row set matches the table as written. A parser that errors here would send the task
   to `error` on the operator's next `drive` (AC12 working as designed, at the worst moment).
3. **The escape hatch stays documented and unchanged** (bug spec §9): the loop is bounded now,
   but if M5 misbehaves, Ctrl-C leaves the task at `ready_to_execute` with the first unfinished
   row intact. No *state* is lost, because every pause and every milestone commits — but note the
   distinction point 1 draws: `state.yml` survives an interrupt, the working tree does not
   necessarily, so an interrupt that lands mid-session is always followed by `git status`.
4. **Do not bump the CLI version or cut a release inside this task.** Releases are the cleanup
   lap's and the operator's business; a mid-execution version bump would make the security
   declaration in M8 describe a version that does not exist yet.
5. The prompt changes in M6 affect **future** tasks only. This task's `03_plan.md` and
   `04_execute.md` were written under the old prompt and are not retro-fitted — the plan lap
   should not spend a milestone rewriting its own inputs.

---

## Testing approach

### Q3: AC1 says "proven by a test that would hang on today's code." How is that actually evidenced?

A test that hangs cannot be committed — it would hang CI. But "would have hung" is the whole
claim of this task, and an unevidenced claim is exactly what QA is for. What gets written, what
gets run, and what gets recorded?

**Answer:**
Write the assertion against the new code, and record the old code's failure as **observed
evidence in the playbook**, the way `plans/0004` recorded its AC2 evidence.

- **Committed test (M5).** `tests/pipeline/handlers/execute.test.ts`: stub `runAndStream` to
  return a fixed message and leave `04_execute.md` byte-identical. Assert
  `runAndStream.mock.calls.length === 2`, `readState().stage === "need_operator"`, and that the
  stubbed final message appears inside the last pause block. Wrap it in vitest's per-test
  `timeout: 5_000` so a regression fails fast instead of hanging the suite.
- **The evidence run (M5, once, not committed).** Before replacing `handleExecute`, run that same
  test file against the old handler on a scratch commit and capture the timeout output. Paste the
  captured output into the M5 row's Notes in `04_execute.md`. That is the artefact QA reads to
  verify AC1, and it costs one command:
  `npx vitest run tests/pipeline/handlers/execute.test.ts --testTimeout=5000`.
  **Stub `commitAll` as well as `runAndStream` for this run.** The old handler's loop body is
  `readFile → runAndStream → commitAll` (`execute.ts:22-44`), so a stub on `runAndStream` alone
  leaves a real `git add .` + commit firing every iteration against this repository until the
  timeout — hundreds of junk commits on the task branch, in the milestone whose whole job is a
  clean cutover.
- **Write the test before the implementation** in M5's task list — it is the only milestone where
  test-first is mandated, because it is the only one where the test *is* the acceptance criterion.
- Everywhere else, tests land in the same commit as the code they cover (the project's existing
  convention); no separate "write the tests" milestone.

---

### Q4: Where do the parser fixtures come from, and what stops them rotting?

`02_design.md` §13.3 makes it a non-negotiable that the parser is tested against the real
`plans/0002`–`0004` tables — a parser that passes synthetic tables and fails `plans/0004`'s
multi-paragraph Notes cells is a parser that breaks in-flight tasks. But this repo's `plans/`
directory mutates: this very task is about to append pause blocks to `plans/0005/04_execute.md`.
Read them live, or snapshot them?

**Answer:**
Snapshot. Tests never read `plans/` at run time.

- **M1 copies the `## Execution Status` section only** — not the whole playbook — out of
  `plans/0002_add-a-consolidate-function`, `plans/0003_fasten-2026-04-16` and
  `plans/0004_add-qa-step` into `tests/fixtures/playbooks/{0002,0003,0004}-status.md`. Each
  fixture opens with an HTML comment naming its source path and the commit it was taken from, so
  a future reader can diff it.
- **Reading `plans/` live would be a test that fails on someone else's machine** (a consumer
  repo has different plans) and a test this very task would break by appending pause blocks.
- **Four synthetic fixtures alongside them**, each named for the criterion it pins:
  `no-heading.md`, `unknown-status.md` (AC12), `legacy-blocked.md` (AC11),
  `pending-in-summary-only.md` (E3). Plus `no-owner-column.md` — which `0002`–`0004` already are,
  so it is covered by the real fixtures rather than duplicated.
- **`pending-in-summary-only.md` is the one that carries full-file shape**, not just a table:
  front matter, prose, and a Milestone Summary table *above* the `## Execution Status` heading.
  Every other fixture is a bare status section, which never exercises "scan for the **first**
  heading that matches" — the step that does the real work of E3. A parser that simply grabs the
  first pipe table in the file passes every other fixture in this list.
- `plans/0004`'s fixture is the important one: it carries `M5a`/`M5b` IDs and Notes cells
  containing inline code, quotes and prose. If the row splitter survives that, it survives the
  field.

---

## Scope and landing

### Q5: Does the `drive` checkout-before-advance fix (E17 / design R3) land in this task?

The design records it as the real fix for the likeliest operator failure — the operator has just
been merging PRs on `main`, ticks the box there, and `drive` cannot see it — but ships only the
legible version: the branch named in the pause block, the pit board and the nothing-to-do hint.
The design review deferred the call to here. In or out?

**Answer:**
**Out — ship the legibility version here, file the reorder as a follow-up.**

Reordering `drive` to check out the task branch *before* the advancement pass changes behaviour
for **every stage**, not just pauses: today an operator can sit on any branch, edit a questions
file, and `drive`; afterwards `drive` would move their working tree first. That is a real change
to the tool's contract, it can surprise an operator mid-edit on an unrelated branch, and it needs
its own thinking about dirty trees and multiple actionable tasks. Bundling it into a bug fix is
exactly the blast-radius argument that kept the guard change out (Q6b).

So this task creates **three** follow-ups, not two — added to the §13 list:

3. **"`drive` operates on the task branch"** — check out before the advancement pass; decide what
   happens with a dirty working tree and with two actionable tasks on different branches.

The mitigation shipping here is not nothing: the pause block's closing line, the pit-board message
and the new nothing-to-do hint all name the branch, so an operator who hits E17 is told why within
one `drive`.

---

### Q6: Where do the docs, the CHANGELOG and the security review sit — execution or cleanup?

The cleanup lap normally owns project documentation, and `qaPrompt` explicitly tells QA **not** to
report stale docs as a gap. But AC20, AC21 and AC22 make specific documents deliverables of this
task. If they land in cleanup, QA cannot verify them and three acceptance criteria go unjudged.

**Answer:**
Execution, in two separate milestones, and the plan says so explicitly so QA judges them.

**M7 — docs + housekeeping** (code-adjacent, one session):
- `CLAUDE.md`: the `(file, marker)` injectivity invariant replacing "one questions file per
  stage", and a Key decision for operator gates and the `need_operator` detour (AC20).
- `docs/how-it-works.md`: rewrite the "Execution Loop" section — it is **already wrong** today
  (it describes one session and checkboxes, not one session per milestone against a status
  table) — plus the detour, the three ways out of a pause, and the known QA-scope limitation
  (AC21).
- `CHANGELOG.md`: one entry, noting the `BASH_BLOCKLIST` count correction (S1) rather than
  rewriting 0.1.0's history. **This overrides `02_design.md` §14**, which assigned the entry to
  the cleanup lap; §14 has been amended to match. The cleanup lap must not add a second entry for
  this task — say so in the M7 row so the cleanup agent reads it.
- **Delete `plans/0005_infinite-loop-fix/execute_infinite_loop_bug.md`** (AC20) — last act of M7,
  after confirming every design decision it carries is reflected in `02_design.md` or the code.
- Create the three follow-up tasks with `vibe-racer new` (§13.1, §13.2, Q5 above).

**M8 — security declaration review**, strictly last and **strictly docs-only** (AC22). It must
change no code, because "guardrails unchanged" is a constraint of this task and a code change in
the final milestone would invalidate it. Its task list is the §12.3 findings table, item by item:
S1 (19 vs 18 blocked commands), S2 (`radio` is not a guarded session and is absent from the
declaration), S3 (root `SECURITY.md` predates 0.3.0), S4 (no-push is prompt-only → Known
Limitations, naming the follow-up), plus the four §12.4 additions. A finding that needs a code
change becomes a fourth follow-up, named in Known Limitations — it does not get fixed here.

Because the plan makes these deliverables, QA treats them as execution scope and an unmet one is
a real finding — which is precisely the behaviour `qaPrompt` already describes for
plan-mandated documentation.

---

# Complete

- [x] Ready to advance to Plan Review
