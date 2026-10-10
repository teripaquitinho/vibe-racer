# Design Questions for #6: drive-enforcements

> **Role**: Senior Software Architect
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-10-10 (revised the same day after the operator's review)

---

The product decisions are settled in `01_product.md` — the verb list and its false positives, no
overrides anywhere, plan-text-only dependency detection, refuse on a dirty tree, one task per
`drive`, leave the operator on the task branch.

**Revision note.** The four questions about making the guard run (the hook transport, the lap
tool list as a restriction, detecting that enforcement is installed, and the wiring/live test
tiers) have left this file. That work is no longer Milestone 0 of this task: it is a task of its
own that races and merges first (`00_objective.md`, *Prerequisite*). Those questions and their
corrected answers travel with it. What remains here are the four questions whose answers most
constrain milestones 1–3. Detail questions (message wording, individual rule cases, doc line
edits) are deliberately left for the plan lap.

## The forbidden-action check — Milestone 1

### Q1: Where does the forbidden-verb list live, what does a match look like, and how does a verification verb exempt a line?

Three consumers need the same list: `signOffPlaybook` (refuses the tick), the plan prompt (teaches
the rule and the verification phrasings), and the AC1.3 test (asserts no prompt or spec contains a
forbidden verb in a gate example). A list copied into three places is a list that will disagree
with itself by the next task. And `01_product.md` §4.4 lets a verification phrasing pass — if the
exemption is "a verification verb appears somewhere on the line", then
`Confirm the build, then merge PR #12` escapes.

**Answer:**
A new leaf module, `src/pipeline/forbidden-actions.ts`, following the discipline `markdown-scan.ts`
already established: **it imports only `markdown-scan.ts`**, so it can be interpolated into prompts
without a cycle, exactly as `execute-table.ts` can.

```
FORBIDDEN_ACTIONS: { id, pattern: RegExp, label: string, kind: "verb" | "command" }[]
                                                              // verb:    merge, push, open/create/close a PR,
                                                              //          tag, release, deploy, publish
                                                              // command: git push, gh pr create|merge,
                                                              //          gh release, gh workflow run
VERIFICATION_VERBS: string[]                                  // confirm, check, verify, inspect

type ForbiddenMatch = {
  source: "execute-table" | "gates-section" | "plan-gate";
  rowId?: string;          // G1
  subject: string;         // the row name or checklist item, verbatim
  clause: string;          // the clause inside the subject that matched
  actionId: string;        // which FORBIDDEN_ACTIONS entry hit
  line: number;            // 1-based, in the file it came from
}

findForbiddenActions(text: string, source: ForbiddenMatch["source"]): ForbiddenMatch[]
describeForbiddenActions(matches: ForbiddenMatch[]): string[]   // the refusal lines, with the rewrite hint
FORBIDDEN_ACTION_SPEC: string                                   // the prose the plan prompt interpolates
```

**The exemption is per clause and positional, never "the word appears".** This is the rule
`01_product.md` §4.4 states and AC1.4 tests:

1. Each scanned subject (a `Name` cell, a `Notes` cell, a bullet, a `## G<n>` heading name, a
   checklist item) is split into **clauses** on `,` `;` `→`, a `/` **with a space on both sides**, and the words
   `then` and `and`. A bare `/` is a path or a ref (`origin/x`, `docs/release.md`), not a
   separator, and splitting on it would cut `origin/x` in two.
2. A clause that contains a `kind: "verb"` match is exempt **only if the clause begins with a
   verification verb** — after stripping list markers, the checkbox and leading markup.
3. A clause that contains a `kind: "command"` match is **never** exempt. A row that quotes
   `gh pr merge` is naming the command to run, whatever verb precedes it.
4. One non-exempt clause refuses the whole subject, and `clause` is what the message quotes.
5. **Verbs match whole words, with their inflections, never substrings.** `tag` matches `tag`,
   `tags`, `tagged`, `tagging`; it does not match `staging`, `stage` or `package`. Without this the
   product's own suggested reword — "configure the staging dashboard" — is refused for containing
   `tag`.
6. **The read-only commands are masked before verb matching.** A whole-word `merge` also matches
   inside `git merge-base` — the verification command the execute prompt and Q4 both use — so a
   checklist item quoting it would be refused. `READ_ONLY_COMMANDS` (`git merge-base`, `git fetch`,
   `gh pr view`, `gh pr list` — the allowances Q2 preserves in the guard, named once in this
   module) are blanked out of the subject **before rule 1 splits it**, so the command's own arguments
   cannot become clauses. Anything else in the subject is still scanned.

Worked cases, which become the test table:

| Subject | Outcome |
|---|---|
| `Merge PR #12` | refused |
| `Confirm the release tag v0.3.0 exists on the remote` | passes |
| `Confirm the build, then merge PR #12` | refused — second clause does not begin with a verification verb |
| `Verify PR #12 is merged and deployed` | refused — `deployed` is its own clause; reword to `Verify PR #12 is merged; verify it is deployed` |
| `Check that \`gh pr merge 12\` succeeded` | refused — command form |
| `Tag the screenshot with the build number` | refused — the accepted false positive; reword to `Label the screenshot …` |
| `Configure the staging dashboard and screenshot it` | passes — `staging` is not `tag` (rule 5) |
| `Update the package version in the stage config` | passes — same |
| `Verify docs/release.md exists` | passes — one clause, begins with a verification verb; the `/` is a path |
| `` `git merge-base --is-ancestor origin/x main` exits 0 `` | passes — read-only command, masked (rule 6) |
| `` Run `git merge-base --is-ancestor origin/x main`, then merge `` | refused — the masked command is inert, the trailing `merge` is not |

Splitting on `and` costs a few extra false positives of the fourth kind. That is the side of the
asymmetry the product chose: a false positive is one reword, an escape is a paid lap.

**Known residual, stated rather than hidden.** `Verify PR #12 is merged` passes, and as a gate it
is still a dependency on unmerged work in verification clothing: at the pause the operator goes
and merges. A keyword check cannot tell "state that already holds" from "state I am waiting for".
The mechanism for that case is the plan-review dependency question (`01_product.md` §4.3), not this
module — which is why the rewrite hint in `describeForbiddenActions` leads with the dependency
answer and uses an already-true example (`Confirm tag v0.3.0 exists on the remote`), never the
refused PR's own number.

A second residual of the same family: `Verify by merging PR #12` passes, because the clause begins
with a verification verb. Rule 2 trusts the leading verb; it does not parse what follows. Accepted
for the same reason, and listed here so nobody mistakes the check for a parser.

Two properties that matter more than the names:

- **`FORBIDDEN_ACTION_SPEC` is built FROM `FORBIDDEN_ACTIONS` and `VERIFICATION_VERBS`**, never a
  hand-written copy — the same rule `EXECUTION_TABLE_SPEC` follows with its status and owner
  unions. Adding a verb changes the prompt, the refusal and the test in one edit.
- **Scanning goes through `scanLines`/`isHeading`/`isLive`**, so a fenced or `> `-quoted example is
  inert here exactly as it is to both table readers (AC1.5). Per `CLAUDE.md`, this makes
  `forbidden-actions.ts` a third consumer of `markdown-scan.ts`: any change to that module now
  requires the four-playbook equivalence check **plus** this module's cases.

**A third call site, after the plan session.** `01_product.md` §4.3 wants the common case caught
before sign-off. The session cannot run `findForbiddenActions` — it has no Bash and runs no code —
so the plan-review handler does, once the session has written `03_plan.md` and `04_execute.md`,
and prints `describeForbiddenActions` as a warning. It never fails the lap and never edits the
files; blocking stays `signOffPlaybook`'s job.

`signOffPlaybook` calls it twice — once over the parsed table's operator rows and the
`## Operator gates in this plan` section of `04_execute.md`, once over `03_plan.md`'s `## G<n>`
headings and checklists — and keeps the existing degradation contract: an unparsable table warns
and allows, while the `03_plan.md` scan runs regardless (AC1.7). Keep it a separate function from
`trailingOperatorRows`; they answer different questions (position vs content) and the product keeps
them as two distinct checks with two distinct messages.

## The remote-write deny list — Milestone 2

### Q2: Where do the five denied commands live, and what does this milestone assume about the guard?

Milestone 2's deny list (`git push`, `gh pr create`, `gh pr merge`, `gh release`,
`gh workflow run`) is the same five commands as the `kind: "command"` entries Q1 puts in
`FORBIDDEN_ACTIONS`. And it is only worth anything once the guard is consulted, which is the
prerequisite task's job, not this one's.

**Answer:**
**One list, two consumers — of the data, not of the regex.** `guard.ts` imports the command
entries from `src/pipeline/forbidden-actions.ts` rather than restating them, so "what a plan may
not ask for" and "what an execute session may not run" cannot drift. What is shared is each
entry's `{ program, subcommand }` pair (`git` + `push`, `gh` + `pr create`, …). The prose `pattern`
in Q1 is built from that pair for scanning markdown; the guard builds its own match from the same
pair against a tokenised shell command, the way `checkBashCommand` already reads one. A regex
written for a sentence is the wrong tool for `cd repo && git -C . push`. The import direction is safe:
`forbidden-actions.ts` is a leaf (Q1), so `guard.ts` importing it cannot create a cycle. It is the
first `claude/` → `pipeline/` import in `guard.ts`; say so in `02_design.md`.

- The rule sits in the Bash branch beside the existing `BASH_BLOCKLIST` check, scoped to
  `ready_to_execute`, and is audited through the same path. It is a **separate constant from
  `BASH_BLOCKLIST`**, so the count `formatGuardSummary` and the three security documents state
  stays a deliberate number rather than a side effect (AC2.4).
- Matching is on the command and its subcommand, not a substring: `gh pr view`, `gh pr list` and
  `git fetch` must pass (AC2.2), so `gh pr` alone can never be the pattern.
- **Where the search for the subcommand stops.** `checkBashCommand` today splits the command on
  whitespace and shell delimiters and compares one word at a time; it has no notion of a
  subcommand and does not respect quotes. "A `push` somewhere after `git`" would deny
  `git commit -m "fix push logic"`, and an execute lap commits constantly. The rule is therefore:
  1. split the command into **segments** on `;` `&&` `||` `|` `&`, newlines and `$(`;
  2. in a segment whose first word (after `VAR=value` prefixes) is the program, the subcommand is
     **the first word that is not an option**, skipping the argument of git's value-taking global
     options (`-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`);
  3. only that word — or, for `gh`, that word and the next (`pr create`, `workflow run`) — is
     compared. Nothing after it is looked at, so a commit message, a branch named `push` or a
     path cannot match.

  | Command | Outcome |
  |---|---|
  | `git push -u origin HEAD` | denied |
  | `cd repo && git -C . push` | denied |
  | `git -c user.name=x push` | denied |
  | `git commit -m "fix push logic"` | allowed — subcommand is `commit` |
  | `git log --grep push` | allowed — subcommand is `log` |
  | `gh pr view 12`, `gh pr list`, `git fetch` | allowed |
  | `sh -c "git push"` | **allowed — stated residual** |
- **Second residual, beside `gh api`: a command inside another shell.** `sh -c "…"`, `bash -c`,
  `eval`, or a script file is an argument to the guard, not a command, and it does not look
  inside. Listed under Known Limitations with `gh api`, not papered over.
- **`gh` itself is not denied (operator decision, 2026-10-10).** Only the five listed commands
  are. The consequence is stated, not hidden: `gh api` can still write to the remote
  (`gh api -X PUT repos/…/pulls/12/merge`), so this milestone makes the *listed* remote writes
  impossible for an execute session — it does not make every remote write impossible. The
  documents say "denies `git push`, `gh pr create`, …", not "cannot push". `01_product.md` §5.4.
- **Tests go against whatever decision function the prerequisite task leaves in `guard.ts`** —
  denials and allowances asserted with equal weight, one case per command. No test in this task
  proves a rule by calling a transport by hand; that was the prerequisite's lesson.
- **Assumption, to be checked at the top of the plan lap, not assumed:** the prerequisite task is
  merged into `main` and this branch is rebuilt on it. If it is not, that is a dependency in
  exactly the sense Milestone 1 defines, and the answer is "sequence", already taken.

## `drive`'s branch orchestration — Milestone 3

### Q3: How does `drive` read a task's tick from that task's branch without moving the working tree?

The ordering problem is real: a task's tick can only be seen on its branch, the candidate set needs
the ticks, and the branch switch needs a clean tree and a *chosen* task. Checking out every task
branch in turn to look is out — it moves the operator's tree before they have agreed to anything.

**Answer:**
Read other branches with `git show`, read the current branch from disk, and only ever check out the
one task that was selected.

1. **`src/git/operations.ts`** gains
   `readFileAtBranch(git, branch, repoRelPath): Promise<string | null>` — a thin
   `git.show` of `<branch>:<path>`, with `null` on "does not exist in branch" and a thrown error on
   anything else. Read-only, no index, no tree movement.
2. **`src/state/discovery.ts`** keeps listing plan folders from the working tree (folder names are
   shared across branches), and gains a per-task resolution step that chooses its source:
   - **the task's branch is the current branch → read from disk.** Non-negotiable: the operator's
     tick is usually *uncommitted* on the branch they are standing on, and `git show` would miss
     it. This is the common "edit a plan file and drive" loop.
   - **the branch exists and is not current → `readFileAtBranch`** for `state.yml` and the stage's
     questions file. **Plus one look at the working tree:** if the working-tree copy of that same
     questions file is modified (`git status`) *and* carries the tick, the task is a candidate
     anyway, marked `tickSource: "working-tree"`. Without this the tick is invisible, the outcome
     is "nothing to do" with no message, and `01_product.md` §9.3's "the message names it" is
     false. With it, step 4's dirty-tree refusal fires and names the file. It is a narrow case —
     most questions files do not exist on `main` at all — but it is the one where silence is the
     wrong answer.
   - **no local branch, but a remote-tracking ref exists (`refs/remotes/*/vibe-racer/NNNN_slug`) →
     `readFileAtBranch` against that ref.** Checked **before** the stage is consulted, because the
     stage on the current branch proves nothing here: the pipeline commits stage changes on the
     task branch, so on `main` a task's `state.yml` says `need_objective` for its whole life
     (verified for #6). Without this check a fresh clone, or a local branch deleted after a push,
     looks like a first `drive`, and step 5 would cut a new local branch from `main` that diverges
     from the one on the remote. With it, `ensureBranch` creates the local branch **from the
     remote-tracking ref** and says so. It reads refs already fetched — `git for-each-ref`, no
     network. Limit, stated: a branch on the remote that was never fetched is invisible, and the
     task is taken for a first `drive`; `drive` does not fetch to find out.
   - **no local branch, no remote-tracking ref, and `state.yml` says `need_objective` → read from
     disk** (first `drive` of a task; the branch is created at step 5 as today). The signal is the
     stage — the one `createPlanFolder` writes and nothing but the pipeline changes — not the
     folder listing: an operator who drops a mock-up or a notes file beside the objective before
     the first `drive` must not turn a new task into a "missing branch".
   - **no local branch, no remote-tracking ref, and `state.yml` is past `need_objective` → read
     from disk, and never create the branch silently.** This is a task whose branch was deleted
     after its merge. It happened in this repository on 2026-10-10: #5's local branch was gone
     while its `06_decision.md` tick sat uncommitted on #6's branch. Creating
     `vibe-racer/0005_…` from the current HEAD would have cut it from another task's work. `ensureBranch`
     refuses, names the missing branch and says how to recreate it
     (`git branch <name> <start-point>`).
3. **A new `src/state/actionable.ts`** turns that into the candidate set defined in
   `01_product.md` §7.2 step 2 — agent stage, or human stage with its `(file, markerText)` pair
   ticked, or `error` under `--retry` — reusing the existing marker readers so "ticked" means
   exactly what `tryAdvance` means by it. `drive` and `pitwall` both want this; give it a home
   outside `drive.ts` from the start.
4. **`driveCommand` becomes the §7.2 sequence as named steps** — `buildCandidates`, `selectTask`,
   `ensureBranch`, `advanceSelected`, `dispatch`, `report` — replacing today's advance-everything
   loop. `ensureBranch` owns the dirty-tree policy: `git.status()`, and if the selected task's
   branch differs from `currentBranch`, refuse when `!status.isClean()`, listing `status.files` in
   git's own `XY path` shape (AC3.3); when the branch is already current it does not look at the
   tree at all (AC3.4).
5. **`advanceSelected` runs `tryAdvance` for the selected task only**, after the checkout. This is
   the behavioural change the design spec must call out: a ticked task that is not selected does
   not advance this run. It is named in the "Also actionable" line and advances on its own `drive`,
   which is what makes one-task-per-run honest rather than a lap silently skipped.

Write both policy decisions and their reasoning into `02_design.md` — AC3.8 asks for the reasoning,
not just the choice.

## Plan review's dependency status — Milestone 1

### Q4: How does the plan-review handler report the status of a named branch or PR?

`01_product.md` §4.3 wants a dependency question to carry the dependency's current status, and
decides the handler obtains it: a review session has no Bash, and once the prerequisite task lands
the guard really denies it. Where does the lookup live, what does it read, and what reaches the
prompt?

**Answer:**
A small module, `src/pipeline/named-refs.ts`, called by the plan-review handler **before**
`runAndStream`, on every round — a status read in round 1 is stale by round 2.

```
type NamedRef   = { kind: "pr"; number: number } | { kind: "branch"; name: string }
type RefStatus  = { ref: NamedRef; status: "open" | "merged" | "closed"
                                         | "ancestor-of-main" | "not-ancestor-of-main"
                                         | "unknown"; detail?: string }

findNamedRefs(text: string): NamedRef[]
resolveRefStatus(git, refs: NamedRef[]): Promise<RefStatus[]>
renderRefStatus(statuses: RefStatus[]): string      // the block planReviewPrompt interpolates
```

- **What is scanned.** The task's own documents that exist at that round — `00_objective.md`,
  `01_product.md`, `02_design.md`, and `03_plan_questions.md` once it has answers. **Not the plan
  the session is about to write**: a dependency named for the first time in `03_plan.md` gets a
  question with no status. Accepted — the alternative is a second pass after the session to
  append statuses to a file the agent wrote. Live lines only,
  through `markdown-scan.ts`, so an identifier inside a fence or behind `> ` is inert here as
  everywhere else. That makes this module a fourth consumer of `markdown-scan.ts`.
- **What counts as an identifier.** A `vibe-racer/NNNN_slug` branch name, or `PR #N`. A bare `#N`
  is **not** enough: in these documents `#6` is a task, `#7` has been a follow-up, a GitHub issue
  and a task in the same week. Requiring the word `PR` costs a missed status now and then, and a
  missed status is just a question without a fact attached — the pre-change behaviour.
- **How status is read.** Branches: `git rev-parse --verify` and `git merge-base --is-ancestor`
  against what is already fetched. PRs: `gh pr view <n> --json state,mergedAt`, only when `gh` is
  on PATH.
- **The network, said plainly.** `gh pr view` is a network call, and the first one `drive` makes
  outside a session. It is accepted: read-only, and it changes nothing in the repository. No
  `git fetch` from the handler — not because of the network, but because a fetch **writes**
  remote-tracking refs, and `drive` moving refs before a lap is a side effect nobody asked for.
- **Every external call has a timeout** (a constant, ~5 s per call, and a cap on how many refs are
  resolved). A hung `gh` — an auth prompt, a dead proxy — would otherwise stall the lap before it
  starts, and "failure is a status" would be false. On timeout the child is killed and the status
  is `unknown` with `detail: "timed out"`.
- **Failure is a status, never an error.** No `gh`, no network, a timeout, a non-zero exit, a
  number that is an issue rather than a PR: `unknown`, with `detail` saying which. The lap runs on
  regardless.
- **Only state reaches the prompt.** `renderRefStatus` prints the identifier and the status enum.
  It never interpolates a PR title, body, author or branch description: that is third-party text,
  and putting it in a prompt is an injection path into a session.
- **`planReviewPrompt` gains an optional `refStatus` argument**, the way `executeMilestonePrompt`
  gained its milestone: the handler computes, the prompt renders. With no named identifiers the
  block is omitted, not printed empty.
- **Scope.** Plan review only. The other three review handlers share `handleReviewWithRounds` and
  must not start shelling out because of this; the lookup is passed in by the plan-review handler,
  not added to the shared runner.

Tests: `findNamedRefs` cases (fenced, quoted, bare `#N` ignored), `resolveRefStatus` with a mocked
`gh` absent / failing / hanging past the timeout / returning each state, and a rendered-prompt test asserting that a PR title
containing instructions never appears in the prompt.

# Complete

- [x] Ready to advance to Design Review
