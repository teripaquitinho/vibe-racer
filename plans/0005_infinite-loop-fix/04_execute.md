# Execution Playbook — #5: infinite-loop-fix

> **Source of truth for progress.** The Execution Status table below is the order and the state.
> The implementation plan (`03_plan.md`) is the source of truth for *what each milestone contains*.
> Do not add scope.

---

## Execution order

Eight milestones, strictly sequential. The ordering rule is one sentence:
**everything that consumes `need_operator` lands before the only thing that produces it.**

```
M1 Table contract + parser        (pure, no callers)
M2 Pause-block format             (pure, no callers)
 └─> M3 State layer + resume path (needs M1 + M2 — will not compile without them)
      └─> M4 Operator surfaces    (drive / pitwall speak about a pause before one can exist)
           └─> M5 THE LOOP        (the only producer of need_operator — AC1 lands here)
                └─> M6 Prompts    (after the loop: never instruct what the pipeline cannot honour)
                     └─> M7 Docs + housekeeping
                          └─> M8 Security declaration review   (strictly last, DOCS ONLY)
```

**M3 before M5 is not negotiable, and half of it is enforced by `tsc`:** `pauseForOperator` lives
in `store.ts` and `"need_operator"` is not a `Stage` until `schema.ts` grows it, so landing M5
first is not a thing that can happen.

**The half `tsc` does not catch is inside M3.** Its `STAGE_QUESTIONS_FILE.need_operator` entry
(`states.ts`) and its `need_operator` delegation in `tryAdvance` (`advancement.ts`) look separable
and are not. Land the map entry without the delegation and every paused task takes the generic
path, passes `validateAnswers` vacuously, gets `null` from `nextStage("need_operator")`, and
`tryAdvance` returns `advanced: true` anyway — a false success on every `drive`, forever. The map
entry, the delegation and the null-next guard go in **one commit**. See `03_plan.md` §1 hazard H1.

---

## Step-by-Step Protocol

For each milestone, in order:

1. Take the **first unfinished row** in the Execution Status table. Do not skip, do not reorder.
2. Set that row's status to `in_progress`.
3. Read the milestone's section in `03_plan.md` — it carries the file paths, function signatures
   and data structures. Implement **all** of its numbered tasks, and nothing outside them.
4. Write the tests listed under that milestone's **Test requirements**. Tests land in the same
   commit as the code they cover — except M5, where the AC1 test is written **first** (see below).
5. Verify, all four, in this order:
   ```bash
   npm run build && npm run typecheck && npm run test && npm run lint
   ```
6. Fix anything that is not green. A milestone is not done until all four are.
7. Set that row's status to `done` and fill in the Notes cell with anything the next milestone or
   QA needs to know.
8. The pipeline commits the milestone.

---

## Rules

- **One milestone at a time.** Take the first unfinished row. No skipping, no reordering, no
  starting a later milestone because the current one is awkward.
- **Always commit.** Every milestone is its own commit, with a passing build and a green suite.
- **Follow the plan.** `03_plan.md` is the specification. If something in it does not work, adapt
  the implementation but keep the same goals — and record the deviation in the Notes cell.
- **Coverage only goes up.** Baseline is **31 test files / 449 tests, all green**. A milestone that
  keeps the suite green by deleting or skipping a test is not done. One recorded exception: M5
  deletes the four cases in `tests/pipeline/handlers/execute.test.ts` that assert the regex-count
  behaviour being removed, and replaces them with a strictly larger set.
- **`guard.ts` is not touched by any milestone.** "Guardrails unchanged" is a constraint of this
  task (AC21), not an oversight. A finding that needs a guard change becomes a follow-up.
- **M8 changes no code.** `git show --stat` for its commit must list only `docs/security.md`,
  `SECURITY.md` and `README.md` (AC22).
- **No version bump, no release.** Releases are the cleanup lap's and the operator's business; a
  mid-execution bump would make M8's declaration describe a version that does not exist yet.
- **No new runtime dependencies.** Nothing is added to `package.json`.

---

## Operator gates in this plan

**None — execution runs start to finish without you.**

There is **one** operator-owned action, and it is deliberately *not* a gate row: the optional
live-cutover interrupt at M5, described in the next section. It stays out of the table because
this playbook is executed by the **old** loop, which counts `pending` rows and runs a session on
each one. An `Owner = operator` row in this table would make that loop spin on it forever —
literally the bug this task exists to fix. See `03_plan.md` §13 D7.

Everything else about operator gates in this task is machinery for **future** plans, written by
the new plan prompt that lands in M6.

---

## Operator interrupt at M5 — optional, skippable, and not an agent step

M5 replaces the loop that is running this very task. **Nothing changes at the moment it commits:**
`handleExecute` is a `while (true)` inside a Node process that imported the module at startup, and
the installed CLI runs `dist/`, not `src/`. Without an interrupt, M6–M8 go on being driven by the
old regex loop — the very bug this task removes — and the live exercise of the new loop never
happens.

| Step | Owner | Note |
|---|---|---|
| `npm run build` | **M5 agent** (last item in its task list) | Load-bearing: `vibe-racer` here is an `npm link`, so the build overwrites the exact bundle the running CLI was loaded from |
| Commit M5 | pipeline | The driver's own `commitAll` |
| **Ctrl-C** | **operator, at the terminal** | The agent session is a *child* of the `drive` process; it cannot interrupt its own parent. This step can never be an agent task |
| `git status`, discard partial M6 work | **operator** | Not optional — see below |
| `vibe-racer drive` | **operator** | New bundle, new loop, M6 onward |

**There is no quiet gap to interrupt in.** The old loop runs `commitAll` → `readFile` → build
prompt → `log.info("Executing milestone 6 …")` → `runAndStream` with nothing in between:
sub-second. So the Ctrl-C lands *inside* the M6 session, which may already have edited files. That
is why the discard step exists. State is safe either way — `ready_to_execute`, M6's row still
unfinished — but the **working tree** is not, and without the sweep the restarted loop runs M6 on
top of uncommitted partial M6 work. The cue to watch for is the `Executing milestone 6` line.

**If you miss the window, nothing is broken.** M6–M8 complete under the old loop, which handles
them fine (the table is well-formed and none of them pause); the only thing lost is the live
exercise. Treat this as a deliberate choice, not a crash and not a required step.

**The escape hatch is unchanged, for every milestone.** M1–M5 all run under the old, unbounded
loop. If one of them stalls, Ctrl-C leaves the task at `ready_to_execute` with the first unfinished
row intact — then `git status` before driving again, because `state.yml` survives an interrupt and
the working tree does not.

---

## Execution Status

Status values: `pending`, `in_progress`, `done`. (`blocked` is removed by this task; it is not
used here.) Owner column deliberately absent — see "Operator gates in this plan" above.

| Milestone | Name | Status | Commit | Notes |
|---|---|---|---|---|
| M1 | Table contract + parser | `pending` | | |
| M2 | Pause-block format | `pending` | | |
| M3 | State layer + resume path | `pending` | | Map entry + delegation + null-next guard in ONE commit (hazard H1) |
| M4 | Operator surfaces | `pending` | | `currentBranch` lands here, not M5 (plan D1) |
| M5 | The loop | `pending` | | AC1 test FIRST; paste the evidence-run output here; then the dry read; then `npm run build`. Operator cutover is optional — see "Operator interrupt at M5" |
| M6 | Prompts | `pending` | | Contract test lands here |
| M7 | Docs + housekeeping | `pending` | | CHANGELOG entry belongs to THIS task, not the cleanup lap — cleanup must not add a second entry |
| M8 | Security declaration review | `pending` | | DOCS ONLY. Record `git show --stat` here as AC22 evidence |

---

## Milestone Summary

### M1 — Table contract + parser

| Item | Detail |
|---|---|
| New files | `src/pipeline/execute-table.ts`, `tests/pipeline/execute-table.test.ts`, `tests/fixtures/playbooks/` (7 fixtures) |
| Modified files | none |
| Key exports | `parseExecutionStatus`, `setMilestoneStatus`, `firstUnfinished`, `rowStatus`, `operatorGates`, `pendingAgentRows`, `doneCount`, `hasOwnerColumn`, `ExecutionTableError`, `MILESTONE_STATUSES`, `OWNERS`, `EXECUTION_TABLE_SPEC` |
| Fixtures | Real `## Execution Status` sections from `plans/0002`, `0003`, `0004` — copied, never read live — plus `no-heading`, `unknown-status`, `legacy-blocked`, `pending-in-summary-only` |
| Validation | Parses all three real tables incl. `plans/0004`'s `M5a`/`M5b` IDs and prose Notes; every throw asserts its message text; `EXECUTION_TABLE_SPEC`'s example round-trips |
| Commit message | `vibe-racer: M1 for #5` |

### M2 — Pause-block format

| Item | Detail |
|---|---|
| New files | `src/pipeline/operator-block.ts`, `tests/pipeline/operator-block.test.ts` |
| Modified files | none |
| Key exports | `OPERATOR_RESUME_MARKER`, `PAUSE_BLOCK_SPEC`, `renderPauseBlock`, `findLastPauseBlock`, `readPauseBlockState`, `untickResumeMarker`, `normalisePauseBlock`, `nextPauseNumber`, `extractGateSection` |
| Validation | **The adversarial round-trip is mandatory** — a rendered block whose agent message contains a ticked marker, a `- [ ]`, a pause heading and a stray fence must still read as unticked with the real items only |
| Do NOT | Reuse `validateDecisionChecklist` — it matches indented items on purpose; this scanner must not. Leave `validation.ts` untouched |
| Commit message | `vibe-racer: M2 for #5` |

### M3 — State layer + resume path

| Item | Detail |
|---|---|
| New files | none |
| Modified files | `src/state/schema.ts`, `src/pipeline/states.ts`, `src/state/store.ts`, `src/state/discovery.ts`, `src/state/advancement.ts`, `src/cli/drive.ts` (call-site fix only), + `states.test.ts`, `store.test.ts`, `advancement.test.ts` |
| Key exports | `pauseForOperator`, `resumeFromOperator`, `clearResumedAt`, `validStage`, `StageQuestions`, `resumeFromOperatorPause` |
| One commit | The `STAGE_QUESTIONS_FILE` map entry, the `tryAdvance` delegation and the null-next guard (H1) |
| Three call sites | `advancement.ts:24`, `drive.ts:100-101`, `states.test.ts:95-103` — all switch to `?.file` |
| Path convention | The three store helpers take an **absolute** plan path. `tryAdvance` runs in `drive`'s un-wrapped loop, so a wrong path takes down `drive` for every task |
| Validation | `(file, markerText)` injectivity test (AC20); resume respects hand edits; an unparseable table at resume returns rather than throws; generic path returns `advanced: false` when there is no next stage |
| Commit message | `vibe-racer: M3 for #5` |

### M4 — Operator surfaces

| Item | Detail |
|---|---|
| New files | none |
| Modified files | `src/git/operations.ts`, `src/cli/drive.ts`, `src/cli/pitwall.ts`, + `drive.test.ts`, `pitwall.test.ts`, `radio.test.ts` |
| Key export | `currentBranch(git)` |
| Validation | Paused tasks render under "Waiting on operator" once, with milestone, reason and file; the hint names the real resume marker; neither "error" nor "failed" appears; `--retry` does not select them; `radio` accepts a paused task |
| Watch for | `pitwall`'s `humanTasks` must now **exclude** `need_operator`, and its empty-state check must count paused tasks |
| Commit message | `vibe-racer: M4 for #5` |

### M5 — The loop

| Item | Detail |
|---|---|
| New files | none |
| Modified files | `src/pipeline/handlers/execute.ts` (rewritten), `src/git/operations.ts`, `tests/pipeline/handlers/execute.test.ts` (rewritten) |
| Key exports | `decideNextStep`, `foldOutcome`, `thresholdFor`, `sessionCap`, `MAX_STALLED_SESSIONS`, `SESSION_CAP_SLACK`, `repoSnapshot` |
| Deleted | `countPendingMilestones`, the `milestone++` counter, the `agent already committed` log line. No shim |
| Order within the milestone | 1. AC1 test. 2. Evidence run against the OLD handler on a scratch commit, stubbing `runAndStream` **and** `commitAll`, output pasted into the Notes cell. 3. `repoSnapshot`. 4. Rewrite. 5. Suite green. 6. Dry read of this file with the new parser. 7. `npm run build` |
| Validation | `runAndStream` called **exactly twice** on an unchanged table, then `stage: need_operator` with the agent's final message in this file; never called for a planned gate; an unparsable table throws and `ai_qa` is never written |
| Commit message | `vibe-racer: M5 for #5` |

### M6 — Prompts

| Item | Detail |
|---|---|
| New files | none |
| Modified files | `src/claude/prompts.ts`, `src/pipeline/handlers/qa.ts`, + `prompts.test.ts`, `qa.test.ts`, `skills.test.ts` |
| Changes | `planReviewPrompt` interpolates `EXECUTION_TABLE_SPEC`; `executeMilestonePrompt` gains the `needs_operator` protocol, the no-push rule and gate verification; `qaPrompt(ctx, gates)`; `chatPrompt` learns `need_operator` |
| Deleted | The hand-written status list containing `blocked` in `planReviewPrompt` |
| Validation | **Contract test** — every `MILESTONE_STATUSES` and `OWNERS` member appears in both rendered prompts; the plan prompt no longer contains the word `blocked`; a malformed table in `handleQa` yields `[]` plus a warning and does not throw |
| Commit message | `vibe-racer: M6 for #5` |

### M7 — Docs + housekeeping

| Item | Detail |
|---|---|
| New files | three follow-up task folders, created with `vibe-racer new` |
| Modified files | `CLAUDE.md`, `docs/how-it-works.md`, `CHANGELOG.md` |
| Deleted files | `plans/0005_infinite-loop-fix/execute_infinite_loop_bug.md` — the **last** act of this milestone |
| Follow-ups | 1. Guard enforces the no-push rule (`git fetch` / `gh pr view` / `gh pr list` must stay allowed). 2. QA scope survives mid-task merges. 3. `drive` operates on the task branch |
| Validation | Suite green; `CLAUDE.md` states the `(file, marker)` invariant that `states.test.ts` enforces; nothing outside this task's own plan documents references the deleted file |
| Commit message | `vibe-racer: M7 for #5` |

### M8 — Security declaration review

| Item | Detail |
|---|---|
| New files | none |
| Modified files | `docs/security.md`, `SECURITY.md`, `README.md` — **and nothing else** |
| Findings to resolve | S1 (18 blocked commands, not 19) · S2 (`radio` is not a guarded session and is absent from the declaration) · S3 (root `SECURITY.md` predates 0.3.0) · S4 (no-push is prompt-only → Known Limitations, naming follow-up 1) |
| Additions | `need_operator` as a human stage · gate verification uses the network vs the `--network none` recommendation · agent prose is committed but quoted inertly and secret-scanned · the execute session's `Edit` on this file is normalised, not trusted |
| Boundary | Docs only. A finding needing a code change becomes a fourth follow-up, named in Known Limitations |
| Validation | `git show --stat HEAD` lists exactly three documentation files — pasted into the Notes cell as AC22 evidence |
| Commit message | `vibe-racer: M8 for #5` |

---

## Stack / Technology Reference

| Tool | Command | Purpose |
|------|---------|---------|
| tsup | `npm run build` | Production build → `dist/` (also the cutover step at M5) |
| TypeScript | `npm run typecheck` | Type checking (`tsc --noEmit`) |
| Vitest | `npm run test` | Unit tests — baseline 31 files / 449 tests |
| ESLint | `npm run lint` | Linting (`eslint src/`) |
| tsx | `npm run dev` | Run the CLI from source, no build |

| Dependency | Used by this task | New? |
|---|---|---|
| `zod` | `stateSchema` gains four optional fields | no |
| `yaml` | `state.yml` read/write | no |
| `simple-git` | `repoSnapshot`, `currentBranch` | new calls on the existing client |
| `@anthropic-ai/claude-agent-sdk` | `runAndStream` — return value now consumed | no |
| `commander`, `chalk`, `ora` | CLI output for the operator group | no |
| `vitest` (dev) | two new test files, seven new fixtures | no |

**No new runtime dependencies.** Nothing is added to `package.json`.

---

# Complete

- [ ] Ready to advance to Execution
