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
owns each document edit. Six questions.

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
| **M2** | Prompt and spec surgery: plan prompt categories + `FORBIDDEN_ACTION_SPEC`, both worked examples, `qaPrompt(ctx)`, `handlers/qa.ts` losing `gatesPassed`, plus `tests/claude/prompts-gate-examples.test.ts` | AC1.3 and AC1.8. Consumes M1's checker to validate M1's own replacement examples — the generated spec checked by the generated checker |
| **M3** | `signOffPlaybook` CHECK B + `tests/state/advancement.test.ts` cases | AC1.2, AC1.4–AC1.7, AC1.9. The one blocking behaviour change in Milestone 1; it deserves a commit of its own so a bisect lands on it |
| **M4** | `pipeline/named-refs.ts` + the plan-review handler bracket (`resolveNamedRefBlock` before, `warnForbiddenActions` after) | AC1.1. The only part of Milestone 1 that shells out and touches the network. Last inside Milestone 1 so that if it over-runs, M1–M3 are already landed and the merge ban is already enforced |
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
It verifies by **reading the merged code**, which is what `Read`/`Grep` are for, and records the
evidence as the first section of `03_plan.md`:

```markdown
## Prerequisite verification (AC0.1)

Checked against `main` at <sha> before this plan was written.

| Requirement | Evidence | Holds? |
|---|---|---|
| Guard rules run from a `PreToolUse` hook on every tool call | `src/claude/<file>:<line>` — the hook is registered in the `query({ options })` call | yes / NO |
| A tool outside the lap's list is denied | `src/claude/<file>:<line>` — the list is applied as a filter, not an auto-approve list | yes / NO |
| Denials reach `.vibe-racer/audit.log` | `src/claude/guard.ts:<line>` → `appendAuditEntry`, reachable from the hook path | yes / NO |
```

Three rules for that section:

1. **Evidence is `file:line`, never prose.** "The hook is installed" is the claim this task is
   not allowed to take on trust — it is the claim whose failure made the whole guard inert in the
   first place.
2. **A `NO` in any row does not get fixed in passing.** It is a dependency in exactly the sense
   Milestone 1 defines, so the plan lap appends a `## Follow-up Questions (Round 2 of 3)` section
   to this file naming it, unticks the checkbox, and writes no plan. The two legitimate answers
   are the same two: sequence this task after the prerequisite's fix, or base this branch on it.
3. **It is not a milestone row and not a test.** It is a verification done once, at plan time, by
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
- **M2 updates `CLAUDE.md`'s *One markdown reader* decision** to name `forbidden-actions.ts` and
  `named-refs.ts` as readers three and four, and to state the grown obligation: a change to
  `markdown-scan.ts` now requires the four-playbook equivalence check
  (`plans/0005_infinite-loop-fix/05_qa_batch-b.md` §6) **plus** `forbidden-actions.test.ts`'s case
  table **plus** `named-refs.test.ts`'s fence and blockquote cases. This is a documentation edit
  that belongs with the milestone that creates the new readers, not with cleanup.
- **One new cross-reader tripwire, in M2.** Take one of the four existing playbook fixtures,
  feed it to all four readers, and assert that the fenced worked example in it yields: zero
  milestone rows, zero pause blocks, zero named refs and zero forbidden matches. Four readers,
  one fixture, one assertion each — it is the cheapest possible statement of "inert to *all*
  four" and it will fail the day a fifth reader is added without the same discipline.
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
| **M2** (prompts/specs) | `CLAUDE.md`: the §2 principle as a Key decision, and the widened markdown-reader obligation (Q5). `docs/how-it-works.md`: drop "QA's diff scope shrinks after a gate" |
| **M3** (sign-off) | `docs/security.md`: a plan cannot ask the operator to merge, with the §3.9 residuals |
| **M5** (guard) | `docs/security.md`, `SECURITY.md`, README "Security": the deny list stated **as a rule** naming its five commands; the "never pushes is a prompt rule only" Known Limitation **replaced**, not deleted, by `gh api` and nested shells; the blocklist count agreeing with `guard.ts` in all three |
| **M7** (`drive`) | `docs/commands.md` and `docs/how-it-works.md`: `drive` checks out the task branch, refuses on a dirty tree, runs one task per invocation, leaves the operator on the branch; the never-fetched-branch limit |

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
- `gh api` and a nested-shell example appear under Known Limitations in all three;
- the string `cannot push` appears in **none** of them (AC2.4's last clause).

It is four assertions over three files, it needs no fixtures, and it is the only thing standing
between a future guard edit and three documents that lie about it.

# Complete

- [ ] Ready to advance to Plan Review
