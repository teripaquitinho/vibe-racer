# Plan Questions for #6: drive-enforcements

> **Role**: Senior Software Engineer
> **Stage**: `ai_design_review` → `need_plan`
> **Date**: 2026-10-10

---

The architecture is settled in `02_design.md` — one list in `pipeline/forbidden-actions.ts`,
`guard.ts` importing its command pairs, `named-refs.ts` called by the plan-review handler,
`readFileAtBranch` + `resolveTaskSources` + `actionable.ts` feeding a six-step `drive`, and both
Milestone 3 policies decided with their reasoning (§17). The product fixed the milestone order:
**1 → 2 → 3**.

What is left is *how to build it*: where the milestone boundaries fall inside that order, how the
prerequisite is checked rather than assumed, which tier each test belongs to, and which milestone
owns each document edit. Six questions, plus a seventh added at the `need_plan` review: the
design defects found there, which the plan must apply **over** `02_design.md` where they differ.

## Build order and milestone boundaries

### Q1: Does Milestone 1 ship as one row, or split — and where do the milestone boundaries fall across all three?

Milestone 1 is four separate pieces of work: a new pure module, surgery on four prompt surfaces,
a new blocking check in `signOffPlaybook`, and a handler that shells out to `gh`. One row means
one session doing all four and one commit to bisect. The order 1 → 2 → 3 is fixed; the split
inside it is not.

**Answer:**
Split into **seven agent rows**, and no operator gates at all. The boundaries follow "every
milestone ends with a passing build and tests, and changes one thing":

| Row | Name | Why it is its own row |
|---|---|---|
| **M1** | `pipeline/forbidden-actions.ts` + `tests/pipeline/forbidden-actions.test.ts` | A pure leaf with zero consumers. Design Q1's worked-case table (`02_design.md` §20.1) goes green before anything depends on it. Zero behaviour change in the CLI — if this row is wrong, nothing downstream has been built on it yet |
| **M2** | Prompt and spec surgery: plan prompt categories + `FORBIDDEN_ACTION_SPEC`, both worked examples, `qaPrompt(ctx)`, `handlers/qa.ts` losing `gatesPassed`, plus `tests/claude/prompts-gate-examples.test.ts` and the **three-reader** tripwire (Q5) | AC1.3 and AC1.8. Consumes M1's checker to validate M1's own replacement examples — the generated spec checked by the generated checker |
| **M3** | `signOffPlaybook` CHECK B + `tests/state/advancement.test.ts` cases | AC1.2, AC1.4–AC1.7, AC1.9. The one blocking behaviour change in Milestone 1; it deserves a commit of its own so a bisect lands on it |
| **M4** | `pipeline/named-refs.ts` + the plan-review handler bracket (`resolveNamedRefBlock` before, `warnForbiddenActions` after), and **everything about the fourth reader**: the tripwire's fourth assertion and the `CLAUDE.md` line naming `named-refs.ts` (Q5) | AC1.1. The only part of Milestone 1 that shells out and touches the network. Last inside Milestone 1 so that if it over-runs, M1–M3 are already landed and the merge ban is already enforced. No earlier row may import or name `named-refs.ts`: it does not exist before this one |
| **M5** | `REMOTE_WRITE_DENYLIST` in `guard.ts`, `formatGuardSummary`, the denial message, guard tests, and the three security documents + `tests/claude/docs-agree.test.ts` | Objective Milestone 2 entire. It is genuinely small — one constant, one `parseInvocations`, one branch — and the documents are what make it true (Q6) |
| **M6** | `readFileAtBranch` / `listRemoteTaskRefs` / `treeStatus`, the `parseStateContent` and `hasCompletionMarkerIn` extractions, `resolveTaskSources`, `state/actionable.ts`, and their tests | Everything Milestone 3 needs, with **`drive.ts` untouched**. Build and tests green with the new machinery present and unwired — the safest possible halfway point in the riskiest milestone |
| **M7** | The six-step `drive.ts` rewrite, `branchHint` deleted, the pause-block closing line, `tests/cli/drive-branch.test.ts`, and the `drive.ts` doc lines | AC3.1–AC3.8. The only row where `drive`'s behaviour changes, and the only row that can leave an operator on the wrong branch if it is wrong |

Rationale for the two halves of Milestone 3 in particular: M6 is additive and provable in
isolation against a real temp repo (Q3); M7 is the behavioural flip. Shipping them as one row
would mean a single session holding a new git reader, two pure-function extractions, a new
module and a command rewrite in its head at once — which is exactly the oversized milestone the
`committed_unfinished` stall wording exists to describe.

**No operator gates.** The playbook's "Operator gates in this plan" section reads
`None — execution runs start to finish without you.` That is both true and a clean demonstration
of Milestone 1's own rule: the one thing that might have looked like a gate (a live guard probe)
is answered in Q4 without one.

### Q2: What exactly does the plan lap do to confirm the prerequisite task's three requirements (AC0.1), given a review session has no Bash?

`01_product.md` §3 lists three requirements this task assumes of the prerequisite task — the
`PreToolUse` hook runs under `bypassPermissions`, a tool outside the lap's list is denied,
denials reach `.vibe-racer/audit.log` — and says they are *checked at the top of the plan lap,
not assumed*. The plan-review session has `Read, Glob, Grep, Write`. It cannot run a probe.

**Answer:**
It verifies with **two kinds of evidence, both mandatory**: the merged code, which is what
`Read`/`Grep` are for, and the **live dry-run record** the prerequisite task writes in its own
`05_qa.md`. A code read alone is the kind of proof that already failed once — `canUseTool` was
there to be read, wired and cited, and never ran. The dry run is the only evidence that the rules
fired in a real session.

The evidence is the first section of `03_plan.md`:

```markdown
## Prerequisite verification (AC0.1)

Read from this branch's working tree, which the operator states is rebuilt on `main` at <sha>
(the sha is copied from the line below Q2's answer; a review session cannot run `git`).

| Requirement | Code evidence | Live evidence | Holds? |
|---|---|---|---|
| Guard rules run from a `PreToolUse` hook on every tool call | `src/claude/<file>:<line>` — the hook is registered in the `query({ options })` call | `plans/<prerequisite>/05_qa.md` §<n> — a dry-run denial recorded from a real session | yes / NO |
| A tool outside the lap's list is denied | `src/claude/<file>:<line>` — the hook's **default-deny** for any tool not in the lap's list (the prerequisite's chosen mechanism; `allowedTools` stays an auto-approve list and is not the authority) | `plans/<prerequisite>/05_qa.md` §<n> — an out-of-list tool denied in the dry run | yes / NO |
| Denials reach `.vibe-racer/audit.log` | `src/claude/guard.ts:<line>` → `appendAuditEntry`, reachable from the hook path | `plans/<prerequisite>/05_qa.md` §<n> — the audit lines quoted from the dry run | yes / NO |
```

**`main` sha, filled in by the operator when ticking** (`git rev-parse main`, after the
prerequisite is merged and this branch is rebuilt on it): `<sha>`

The handler that runs this plan lap is the pre-#6 one and passes no sha, so the operator supplies
it. If the line still reads `<sha>` when the lap runs, that is a `NO`.

Four rules for that section:

1. **Code evidence is `file:line`, never prose.** "The hook is installed" is the claim this task
   is not allowed to take on trust — it is the claim whose failure made the whole guard inert in
   the first place.
2. **Live evidence is a section of the prerequisite's `05_qa.md`, quoted.** A missing report, a
   report with no dry-run record, or a record that does not show the denial is a `NO` for that
   row, however convincing the code reads.
3. **A `NO` in any row does not get fixed in passing.** It is a dependency in exactly the sense
   Milestone 1 defines, so the plan lap appends a `## Follow-up Questions (Round 2 of 3)` section
   to this file naming it, unticks the checkbox, and writes no plan. The two legitimate answers
   are the same two: sequence this task after the prerequisite's fix, or base this branch on it.
4. **It is not a milestone row and not a test.** It is a verification done once, at plan time, by
   the lap that would otherwise plan on a false premise. A test asserting the prerequisite's own
   behaviour would be asserting someone else's milestone (`02_design.md` §20.6).

If the branch has not been rebuilt on the prerequisite's `main` when the plan lap runs, that is
the same `NO` and gets the same treatment.

## Testing approach

### Q3: `tests/cli/drive.test.ts` mocks `git/operations.js` wholesale. Do the Milestone 3 tests extend it, or go against a real repository?

The thing under test in M6/M7 is whether `git show <branch>:<path>` returns what
`resolveTaskSources` assumes, whether `git show` distinguishes "no such path" from "no such ref"
by its error wording, and whether a checkout behaves as `ensureBranch` expects. A mock that
returns what the code expects proves none of it.

**Answer:**
**Both tiers, in two files, with the split drawn at "does this assertion depend on git's real
behaviour?"**

- **`tests/cli/drive.test.ts` stays mocked** and is updated for the new call order. It owns what
  it is good at: message text, the `--task N` and `--retry` paths, `ineligibleMessage` wording,
  the "Also actionable" line, `report`'s three lines, and that `dispatch` is called with the
  right stage. Keeping it green through the M7 rewrite is the regression gate on every message
  #5 and earlier tasks fought for.
- **`tests/cli/drive-branch.test.ts` is new and uses a real temporary repository**, following the
  pattern `tests/git/operations.test.ts` already establishes. One fixture builder per test:
  `git init`, a commit on `main`, a `vibe-racer/0006_…` branch carrying a committed plan folder,
  and — for the `remote-only` case — a fake remote-tracking ref made with
  `git update-ref refs/remotes/origin/vibe-racer/0006_… <sha>`. No network, no second clone.

  It owns every row of `02_design.md` §8.3's source-selection table and §10.3's `ensureBranch`
  table, plus AC3.1–AC3.6 end to end.

Two assertions in the real-repo file matter more than the rest and should be written first,
because they are the ones that encode an assumption about an external tool:

1. `readFileAtBranch` returns `null` for a path absent from the ref, and **throws** for a bad
   ref — asserted against git's actual messages, so a future git wording change fails loudly
   instead of turning every task into "first drive" (`02_design.md` §7).
2. An uncommitted tick on the **current** branch is seen, and the same tick on a **non-current**
   branch is not seen by `git show` but *is* seen by the §8.4 working-tree look.

Run the real-repo file with a per-test temp dir and `git -c init.defaultBranch=main`, and set
`user.name`/`user.email` locally in the fixture so the suite does not depend on the developer's
global git config.

### Q4: AC2.1 says each denied command is "refused and audited from a `ready_to_execute` session". This task does not install the hook. What actually proves it, and is a live probe an operator gate?

The honest shape of the problem: the decision function is this task's, the transport is the
prerequisite's, and nothing in a unit test exercises both. The tempting move is an operator gate
— "operator runs a real execute session and confirms the denial" — which would be the first gate
in this task's own playbook.

**Answer:**
**Unit tests at the decision layer, an explicit statement of the seam in the QA report, and no
operator gate.**

1. **The tests call the function the hook calls.** `createToolGuard(options)` returns the
   decision function; the prerequisite's hook invokes it. `tests/claude/guard.test.ts` asserts
   one case per command in both directions (`02_design.md` §20.2) by calling that function with
   `stage: "ready_to_execute"` and `toolName: "Bash"` — never by calling a transport by hand,
   which was the prerequisite's lesson. "Audited" is asserted the way `tests/claude/audit.test.ts`
   already asserts it: the denial appends a line to `.vibe-racer/audit.log` in a temp cwd.
2. **The seam is named in `05_qa.md`, not papered over.** The QA lap has `Bash` and will say, in
   "Risks and known limitations", exactly this: the rule is proven at the decision function and
   at the audit write; that the SDK consults that function under `bypassPermissions` is the
   prerequisite task's property, verified by Q2's plan-time code read and by the prerequisite's
   own live tier. One sentence, with the evidence pointer.
3. **No gate, for three reasons.** It would be verification by eye of something the unit test
   already covers at the layer this task owns; a gate pauses a paid lap and the information
   gained is "the prerequisite task works", which Q2 has already established from the code; and
   the playbook staying gate-free is itself a small proof that Milestone 1's categories are
   livable.

If the operator *wants* the live check, the place for it is the `need_execution` pit stop or the
`fine_tuning` review — both are stops they are already making, and neither costs a lap.

### Q5: `CLAUDE.md` requires the four-playbook parse equivalence check whenever `markdown-scan.ts` changes. This task adds two consumers without changing it. Do we run the check anyway?

The obligation as written is triggered by a *change to the module*. This task adds readers three
and four and changes nothing in the scanner. Running a check for a change nobody made is theatre;
skipping a check because of a technicality is how the original drift happened.

**Answer:**
**Do not run the four-playbook check. Widen the obligation instead, and add one cheap tripwire.**

- **No equivalence check in this task.** Its purpose is to re-establish that both table readers
  agree *after the scanner moved*. The scanner does not move here, so there is nothing to
  re-establish, and a green run would be evidence of nothing.
- **`CLAUDE.md`'s *One markdown reader* decision grows with the reader, one milestone each.**
  **M2** names `forbidden-actions.ts` as reader three and states the obligation as it then
  stands: a change to `markdown-scan.ts` requires the four-playbook equivalence check
  (`plans/0005_infinite-loop-fix/05_qa_batch-b.md` §6) **plus** `forbidden-actions.test.ts`'s case
  table. **M4** names `named-refs.ts` as reader four and adds `named-refs.test.ts`'s fence and
  blockquote cases to that obligation. `named-refs.ts` is created in M4; M2 must not name a
  module that does not exist yet.
- **One cross-reader tripwire, started in M2 and completed in M4.** Take one of the four
  existing playbook fixtures and assert that the fenced worked example in it is inert to every
  reader. M2 writes it for the **three** readers that exist: zero milestone rows, zero pause
  blocks, zero forbidden matches. M4 adds the fourth assertion: zero named refs. One fixture, one
  assertion per reader — the cheapest possible statement of "inert to *all*", and it will fail
  the day a fifth reader is added without the same discipline.
- **A stop rule for the execute lap.** If a session finds itself editing `markdown-scan.ts` to
  make `forbidden-actions.ts` or `named-refs.ts` work, that is a signal the design was wrong, not
  a small fix. Stop, run the full four-playbook check, and say so in the commit — do not change
  the scanner quietly inside a milestone about something else.

## Documents and what makes a claim true

### Q6: Which milestone owns each document edit, and is `docs-agree.test.ts` worth building?

This task changes `CLAUDE.md`, `docs/how-it-works.md`, `docs/security.md`, `SECURITY.md`, the
README and `docs/commands.md`. The default shape is a trailing "update the docs" milestone. The
other option is to make each milestone carry the documents its own change makes true.

**Answer:**
**Each milestone owns the documents its change makes true. No trailing docs row. And yes, build
the test.**

| Milestone | Documents it must leave true |
|---|---|
| **M2** (prompts/specs) | `CLAUDE.md`: the §2 principle as a Key decision, and the markdown-reader obligation widened to reader **three** (Q5). `docs/how-it-works.md`: drop "QA's diff scope shrinks after a gate". `CHANGELOG.md`: the plan prompt no longer plans a merge; the QA coverage statement is gone |
| **M3** (sign-off) | `docs/security.md`: a plan cannot ask the operator to merge, with the §3.9 residuals. `CHANGELOG.md`: the sign-off refusal |
| **M4** (named refs) | `CLAUDE.md`: reader **four** added to the markdown-reader obligation (Q5). `docs/how-it-works.md` and `docs/security.md`: at plan review `drive` itself — outside any session — runs `gh pr view` once per named PR; read-only, 5-second timeout, skipped without `gh`, nothing fetched or changed. `CHANGELOG.md`: the same sentence |
| **M5** (guard) | `docs/security.md`, `SECURITY.md`, README "Security": the deny list stated **as a rule** naming its five commands; the "never pushes is a prompt rule only" Known Limitation **replaced**, not deleted, by `gh api` and nested shells; the blocklist count agreeing with `guard.ts` in all three. `CHANGELOG.md`, under Security: the deny list |
| **M7** (`drive`) | `docs/commands.md` and `docs/how-it-works.md`: `drive` checks out the task branch, refuses on a dirty tree, runs one task per invocation, leaves the operator on the branch; the first-`drive` refusal from another task's branch and the merged-task rule (Q7); the never-fetched-branch limit. `CHANGELOG.md`, under Changed: only the selected task advances per `drive` |

`CHANGELOG.md` follows the same rule as every other document: each row that changes behaviour
adds its own line under `## [Unreleased]` in the same commit. M1 and M6 change no behaviour and
add none.

Three reasons for this shape over a trailing row. A trailing documentation row would be a row
with nothing after it, which `trailingOperatorRows` and the plan prompt already push out of the
table. A milestone that lands a guarantee and a document claiming it in the same commit cannot
drift between them. And a document edited at the end is edited by a session that no longer
remembers why.

**`tests/claude/docs-agree.test.ts` is worth it, and it belongs in M5.** The three security
documents were corrected into agreement by hand in #5 M8 and `CLAUDE.md` says to keep them
agreeing — a sentence is not a mechanism. The test reads the three files and asserts:

- `BASH_BLOCKLIST.length` appears as the stated count in all three;
- each of the five `FORBIDDEN_COMMANDS` labels is named in all three;
- `gh api` and the indirection class — with at least a nested-shell and a git-alias example
  (Q7.3) — appear under Known Limitations in all three;
- the string `cannot push` appears in **none** of them (AC2.4's last clause).

It is four assertions over three files, it needs no fixtures, and it is the only thing standing
between a future guard edit and three documents that lie about it.

## Design corrections

### Q7: The `need_plan` review found five defects in `02_design.md`. What does the plan build instead?

Each was checked against the code or the repository on 2026-10-11. Where this answer and
`02_design.md` disagree, **this answer wins**; the plan cites it by number (Q7.1–Q7.5).

**Answer:**

**Q7.1 — Verb inflection (§3.4, M1).** `\b${verb}(?:s|ed|ing|d)?\b` was run as written: it
misses `Merging PR #12` and `Operator pushes the branch`, and the irregular table covers only
`tag`, `release` and `publish`. Build `inflect()` from general rules instead of a per-verb table:

- a stem ending in `e` drops it before `-ing` (`merging`, `releasing`, `closing`, `creating`);
- a stem ending in `s`, `sh`, `ch`, `x` or `z` takes `-es` (`pushes`, `publishes`);
- before `-ed` and `-ing` the final consonant of **any** stem may be doubled, optionally
  (`tagged`, `tagging`). Optional and for every verb on purpose: deciding which stems double
  needs syllable rules (`tag` does, `open` does not), and accepting a form that is not a word
  (`openned`) costs nothing — it never appears, and if it did it would mean the same thing;
- the multi-word entries (`open a PR`, `close a PR`, `create a PR`) are a verb, an **optional**
  determiner (`a`, `the`, or none) and `PR`/`PRs`/`pull request(s)`, with the verb inflected by
  the same rules — so `opens the PR`, `closing a PR` and `close PR #12` are all caught.

The test is a generated grid, not a sample: **every verb × every form** (base, `-s`/`-es`, `-ed`,
`-ing`) is asserted refused, beside the existing rule-5 negatives (`staging`, `stage`, `package`).

**Q7.2 — Read-only masking (§3.4 step 0, M1).** "Up to the next clause separator" swallows
``Run `git fetch && git push` `` whole, because `&&` is not a clause separator. The mask stops at
the **first** of: a shell separator (`;`, `&&`, `||`, `|`, `&`, newline), the closing backtick of
the code span it started in, or a clause separator. Two cases join the §20.1 table:
``Run `git fetch && git push` `` → refused; ``Run `git fetch`; then `git push` `` → refused.

**Q7.3 — `parseInvocations` (§5.2, M5).** Taking the first word of a segment lets ordinary shell
through: `if ok; then git push; fi`, `( git push )`, `time git push`, `env X=1 git push`,
`command git push`. That is well past the two residuals the design declares. Instead:

1. tokenise each segment **respecting quotes**, and treat a backtick as a segment boundary (as
   `checkBashCommand` already does);
2. strip leading shell keywords and grouping — `if`, `then`, `else`, `elif`, `do`, `while`,
   `until`, `!`, `{`, `(` — and known wrappers with their own options and assignments — `time`,
   `env`, `command`, `exec`, `nohup`, `sudo`, `xargs`, `builtin`;
3. only then take the program, and skip `gh`'s value-taking global options (`-R`/`--repo`) the
   way git's are skipped, so `gh -R owner/repo pr merge 12` is denied.

Every form above is a **denied** row in `guard.test.ts`; `git commit -m "if ok; then git push"`
stays **allowed** (the quote-aware tokeniser is what makes that true).

The stated residuals are **two classes, not two commands**, and the documents name them as
classes so they do not promise more than the parser delivers:

- **indirection** — anything where the program or subcommand is not literally in the command
  line the guard reads: a nested shell (`sh -c`, `eval`), a script file, a variable
  (`g=git; $g push`), a git alias (`git -c alias.p=push p`, or one in the operator's config), a
  shell function or alias;
- **`gh api`**, which can write to the remote without any of the five subcommands.

`docs-agree.test.ts` (Q6) asserts the indirection class is named with at least the nested-shell
and alias examples, not just `sh -c`. `git -c alias.p=push p` and `g=git; $g push` are
**allowed** rows in `guard.test.ts`, labelled as the residual, so a future reader sees the limit
in the test table rather than discovering it.

**Q7.4 — The first `drive` must not cut a task from another task's branch (§10.3, M7).**
`checkoutBranch` creates the branch at the current HEAD. Until now the operator was usually on
`main`; after M7 `drive` leaves them on the task branch, so `new` then `drive` would cut the next
task from the previous one's unmerged work — the defect §19.1 calls "specific and bad", as the
normal case. **Decision: refuse.** In the `missing` + `need_objective` row, if the current branch
is a `vibe-racer/*` branch other than the task's own, `ensureBranch` starts nothing and prints:

```
Task #7 has no branch yet, and you are on vibe-racer/0006_drive-enforcements — another task's
branch. vibe-racer will not cut #7 from it. Switch to main and run `vibe-racer drive` again:
  git checkout main
If #7 is meant to be based on that task, create the branch yourself and drive again:
  git branch vibe-racer/0007_slug vibe-racer/0006_drive-enforcements
```

Refuse rather than silently start from `main`: basing a task on another branch is one of the two
legitimate dependency answers (Milestone 1), and it stays available as an explicit act. From any
other branch (`main`, a detached HEAD, the operator's own branch) the row behaves as designed.

**Q7.5 — A task already merged, with its old ref still around (§8.3, §16.3, §19.1, M6/M7).**
The design's example is wrong on the facts: on `main` #5 is at `need_decision`, not
`need_objective`, and `origin/vibe-racer/0005_infinite-loop-fix` exists. Under §8.3 as written #5
is case 3 — read from the remote ref, without the working-tree look — so a tick made on `main` is
never seen, and if it were, a lap would run on a stale branch. §19.1's "case 5 catches it" does
not apply either: case 5 needs *no branch anywhere*.

An ancestry test does not fix it: #5 was **squash-merged** (`53346a8` has one parent; 21 commits
on the remote ref are not in `main`), so `merge-base --is-ancestor` says no. The rule that
survives a merge, a squash and a rebase alike compares the plan folder itself. A new case,
evaluated **before** cases 2 and 3:

| # | Condition | `branchState` | `source` |
|---|---|---|---|
| 1a | the task's branch is not current; **the stage read from the task's ref is past `need_objective`**; and the committed `plans/NNNN_slug/` on `HEAD` is identical to the one on the task's ref (`git diff --quiet <ref> HEAD -- <folder>`), **or** the ref is an ancestor of `HEAD` | `merged` | `working-tree` |

**Why the stage condition.** Without it a branch that was just cut and has no commits of its own
is "merged": its plan folder is identical to `HEAD`'s and it is an ancestor of `HEAD`. That is
the state a task is left in when its first lap fails before committing (and #6's own folder is
committed on `main`, so the folder half matches too). The next `drive` from `main` would then
run objective review — which writes only plan documents — and commit it on `main`. A task that
has really been merged has always moved past `need_objective` on its ref; a branch with nothing
on it has not. If the ref carries no `state.yml` at all, 1a does not apply. `drive-branch.test.ts`
gets this fixture: a branch at `main`'s tip, stage `need_objective` → **not** `merged`, falls
through to case 2.

`ensureBranch` for `merged` never checks anything out. Whether the lap runs on the current
branch is the operator's decision, taken as follows:

- **Never on another task's branch.** If the current branch is a `vibe-racer/*` branch, it is
  some other task's (the task's own would be case 1), and `ensureBranch` refuses — the same rule
  as Q7.4, for the same reason. `HEAD` is whatever the operator is standing on: from #6's branch
  #5 looks just as merged as it does from `main`, and "finishing it here" would commit #5's
  `done` inside #6's diff, which QA then reviews as #6's work. That is the tangle of 2026-10-10,
  made automatic. The message says to switch to the branch the task was merged into (normally
  `main`) and drive again.
- **Proceed, committing on the current branch**, only when the step writes nothing but the
  task's plan documents — markdown under `plans/NNNN_slug/`, plus the `state.yml` the pipeline
  itself writes — **and** every dirty path is inside that folder (`commitAll` stages `.`). The
  certain instance is the `need_decision` tick → `done`. `drive` says so before it commits:
  `Task #5 is already merged into <branch>; finishing it here.`
- **Otherwise refuse and leave the choice to the operator.** A lap that would write code, or a
  tree dirty outside the plan folder, starts nothing. The message names the case and the options
  without picking one: recreate the task branch from a start point of their choosing and `drive`
  there, or finish the task by hand.

The plan lap fixes the exact set of stages that count as "plan documents only" by reading what
each handler writes; if it is not obvious for a stage, that stage refuses.

**`finalizeTask` must not check out for a `merged` task.** It calls `checkoutBranch` before
`commitAll` today, and `02_design.md` §10.4 decides to leave that call in as a harmless second
checkout. For `merged` it is not harmless: the task's local branch does not exist, so
`checkoutBranch` would **create** it at the current HEAD and commit `done` there — the opposite
of "finishing it here", and a new stale branch besides. So `finalizeTask` takes the branch
decision from `ensureBranch` instead of making its own: it receives the prepared result and
checks out only when `ensureBranch` did. This overrides §10.4's "leave it" for every case, not
just this one — one place decides the branch, and `finalizeTask` no longer has an opinion.

`drive-branch.test.ts` gains the squash-merged fixture (the ref and `HEAD` share a tree, not
history) in both outcomes, plus three more: the no-commits branch at `need_objective` (not
`merged`); a merged task driven from another task's branch (refused); and the `need_decision`
tick finished from `main`, asserting the commit lands on `main` and **no** `vibe-racer/NNNN_slug`
branch exists afterwards. §16.3's walk-through is corrected to the squash-merged case.

**Minor, fixed in `02_design.md` directly:** §2 names `isTreeClean()` where §7 defines
`treeStatus()` — `treeStatus()` is the name; §1.2 says "fourth and fifth consumers" of
`markdown-scan.ts` where they are the third and fourth.

# Complete

- [ ] Ready to advance to Plan Review
