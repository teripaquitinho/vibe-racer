# Design Specification for #6: drive-enforcements

> **Role**: Senior Software Architect
> **Stage**: `ai_design_review` → `need_plan`
> **Date**: 2026-10-10
> **Sources**: `00_objective.md` (milestones 1–3, *Decisions already made*), `01_product.md`
> (§1–§11) and `02_design_questions.md` (Q1–Q4, answered). Every decision below cites the Q&A,
> product section or acceptance criterion it comes from. Where this document decides something
> the answers left open, it says so with the word **Design call**.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Directory Structure](#2-directory-structure)
3. [Module: `pipeline/forbidden-actions.ts`](#3-module-pipelineforbidden-actionsts--design-q1)
4. [Module: `pipeline/named-refs.ts`](#4-module-pipelinenamed-refsts--design-q4)
5. [Changes to `claude/guard.ts`](#5-changes-to-claudeguardts--design-q2)
6. [Changes to `state/advancement.ts`](#6-changes-to-stateadvancementts--design-q1)
7. [Changes to `git/operations.ts`](#7-changes-to-gitoperationsts--design-q3)
8. [Changes to `state/discovery.ts`](#8-changes-to-statediscoveryts--design-q3)
9. [Module: `state/actionable.ts`](#9-module-stateactionablets--design-q3)
10. [Changes to `cli/drive.ts`](#10-changes-to-clidrivets--design-q3)
11. [Prompt surface changes](#11-prompt-surface-changes--m1)
12. [Changes to `pipeline/operator-block.ts`](#12-changes-to-pipelineoperator-blockts--m3-signposting)
13. [Handler changes](#13-handler-changes)
14. [Integration Patterns](#14-integration-patterns)
15. [State Management Design](#15-state-management-design)
16. [Data Flow](#16-data-flow)
17. [The two Milestone 3 policy decisions, with reasoning](#17-the-two-milestone-3-policy-decisions-with-reasoning--ac38)
18. [Configuration and Environment](#18-configuration-and-environment)
19. [Edge cases, residuals and what stays broken](#19-edge-cases-residuals-and-what-stays-broken)
20. [Testing Strategy](#20-testing-strategy)
21. [Build and Distribution](#21-build-and-distribution)
22. [Dependency Summary](#22-dependency-summary)
23. [Traceability: acceptance criteria → module](#23-traceability-acceptance-criteria--module)

---

## 1. Architecture Overview

### 1.1 What this task adds, architecturally

Three enforcement points, two new leaf modules, and one restructured command. Nothing in the
state machine moves (`01_product.md` §7.1).

| Milestone | New enforcement point | Where it lives |
|---|---|---|
| **1** | A plan may not *declare* a forbidden action | `pipeline/forbidden-actions.ts`, consumed by `signOffPlaybook`, `planReviewPrompt` and a spec test |
| **2** | An execute session may not *run* one | `claude/guard.ts`, importing the command half of the same list |
| **3** | `drive` reads and writes the task's branch, never "whatever is checked out" | `git/operations.ts` + `state/discovery.ts` + `state/actionable.ts`, orchestrated by `cli/drive.ts` |

The single most important structural property, and the reason M1 and M2 are one task rather than
two: **one list, three consumers, no copies** (design Q1, Q2). `FORBIDDEN_ACTIONS` is the source
of the prose spec the plan prompt teaches, the refusal the sign-off prints, and the deny list the
guard enforces.

### 1.2 Module graph after this task

`forbidden-actions.ts` follows the discipline `markdown-scan.ts` established (`CLAUDE.md`, *One
markdown reader*): it imports **only** `markdown-scan.ts`, so it can be interpolated into
`prompts.ts` without a cycle, exactly as `execute-table.ts` can.

```
                        ┌──────────────────────┐
                        │  markdown-scan.ts    │  leaf: imports NOTHING
                        │  scanLines/isHeading │
                        │  /isLive             │
                        └──────────┬───────────┘
            ┌──────────────┬───────┴────────┬──────────────────┐
            │              │                │                  │
   ┌────────▼───────┐ ┌────▼───────────┐ ┌──▼───────────────┐ ┌▼────────────────┐
   │execute-table.ts│ │operator-block  │ │forbidden-actions │ │named-refs.ts    │
   │ (reader 1)     │ │.ts (reader 2)  │ │.ts (reader 3)    │ │(reader 4)       │
   └────────┬───────┘ └────┬───────────┘ └──┬────────┬──────┘ └┬───────┬────────┘
            │              │                │        │          │       │
            │              │                │        │          │  ┌────▼─────────┐
            │              │                │        │          │  │simple-git    │
            │              │                │        │          │  │+ child_process│
            │              │                │        │          │  └──────────────┘
   ┌────────▼──────────────▼────────────────▼──┐  ┌──▼────────────▼──┐
   │  state/advancement.ts  signOffPlaybook    │  │ claude/prompts.ts │
   │  CHECK A trailing rows (existing)         │  │ FORBIDDEN_ACTION_ │
   │  CHECK B forbidden actions (new)          │  │ SPEC, refStatus   │
   └───────────────────────────────────────────┘  └───────────────────┘
                                             │
                                  ┌──────────▼────────────┐
                                  │ claude/guard.ts       │
                                  │ REMOTE_WRITE_DENYLIST │  ← first claude/ → pipeline/
                                  │ (from FORBIDDEN_       │     import in guard.ts (Q2)
                                  │  COMMANDS)             │
                                  └───────────────────────┘
```

**The third and fourth consumers of `markdown-scan.ts`.** `CLAUDE.md` today says a change to
`markdown-scan.ts` changes *both* readers at once and requires the four-playbook parse
equivalence check (`plans/0005_infinite-loop-fix/05_qa_batch-b.md` §6). After this task it
changes **four** readers, and the obligation grows: the equivalence check **plus**
`forbidden-actions.ts`'s case table **plus** `named-refs.ts`'s fence/quote cases. `CLAUDE.md`'s
*One markdown reader* decision is updated to say so (design Q1).

This task does **not** modify `markdown-scan.ts`. That is deliberate and worth stating: the
equivalence check is not triggered by this task's own work, only by future work.

### 1.3 `drive` before and after (Milestone 3)

```
BEFORE                                  AFTER (01_product.md §7.2)
──────────────────────────────          ─────────────────────────────────────────────
discoverTasks (working tree)            discoverTasks (working tree: folder names only)
  │                                       │
for EVERY human-stage task:              resolveTaskSources(git, tasks)
  tryAdvance  ← reads the tree            │  per task: current branch? local? remote-only?
  │             the operator is           │  missing? → read state.yml + questions file
  │             standing on               │  from THAT source, via `git show` (no checkout)
selectTask (agent stages)                  │
  │                                      buildCandidates  ← "actionable", read per branch
checkoutBranch                             │
  │                                      selectTask  ← ONE task (--task N, else lowest number)
dispatch                                   │
                                         ensureBranch  ← dirty-tree policy + checkout/create
                                           │
                                         advanceSelected  ← tryAdvance for THAT task only,
                                           │                 on THAT branch
                                         dispatch
                                           │
                                         report  ← "You are now on <branch>", next action,
                                                    "Also actionable: …"
```

The behavioural change this inverts: today the advancement pass runs **before** the checkout and
for **every** task; after M3 it runs **after** the checkout and for **one** task (design Q3
step 5). A ticked task that is not selected does not advance this run — it is named in the "Also
actionable" line and advances on its own `drive`.

### 1.4 Layering rules this task introduces

1. **`forbidden-actions.ts` imports only `markdown-scan.ts`.** Enforced by review, and by the
   fact that `prompts.ts` imports it (a cycle would fail the build).
2. **`guard.ts` imports `pipeline/forbidden-actions.ts`** — the first `claude/` → `pipeline/`
   import in that file (design Q2). Safe because the target is a leaf. Stated here so it is a
   recorded decision rather than a surprise in review.
3. **`named-refs.ts` is the only module in `pipeline/` that shells out.** It is called by the
   plan-review *handler*, never by a session, and never by the shared `handleReviewWithRounds`
   runner (design Q4, *Scope*).
4. **The CLI layer still never parses a plan file.** `drive.ts` and `pitwall.ts` read
   `Task`/`Candidate` records; the parsing lives in `state/` and `pipeline/`. This is why
   `tickSource` and `branchState` are fields on `Candidate` rather than something `drive.ts`
   computes.

---

## 2. Directory Structure

```
src/
  cli/
    drive.ts                 ← REWRITTEN as the §7.2 named steps; branchHint DELETED
    pitwall.ts               ← (unchanged in M1–M3; a follow-on consumer of actionable.ts)
  pipeline/
    markdown-scan.ts         ← UNCHANGED (deliberately)
    execute-table.ts         ← EXECUTION_TABLE_SPEC worked example loses its merge gate
    operator-block.ts        ← closing line reworded; branchName drops out of the block
    forbidden-actions.ts     ← NEW. The one list. Leaf (markdown-scan only)
    named-refs.ts            ← NEW. Dependency status lookup for plan review
    states.ts                ← UNCHANGED
    handlers/
      plan-review.ts         ← named-refs before the session, forbidden-actions after
      qa.ts                  ← gatesPassed() DELETED
  claude/
    guard.ts                 ← REMOTE_WRITE_DENYLIST at ready_to_execute
    prompts.ts               ← plan prompt, both specs, qaPrompt signature, planReviewPrompt arg
  state/
    discovery.ts             ← + resolveTaskSources(): per-task state source
    actionable.ts            ← NEW. The candidate set
    advancement.ts           ← signOffPlaybook gains CHECK B
    store.ts                 ← + parseStateContent(): the pure half of readState
  git/
    operations.ts            ← + readFileAtBranch(), listRemoteTaskRefs(), treeStatus()

tests/
  pipeline/forbidden-actions.test.ts   ← NEW (the Q1 case table, verbatim)
  pipeline/named-refs.test.ts          ← NEW
  state/actionable.test.ts             ← NEW
  cli/drive-branch.test.ts             ← NEW (real temp git repo; see §20.3)
  claude/prompts-gate-examples.test.ts ← NEW (AC1.3)
  claude/docs-agree.test.ts            ← NEW (AC2.4)

docs/
  security.md                ← deny list as a rule; two residuals; counts
  how-it-works.md            ← drops "QA's diff scope shrinks after a gate"
SECURITY.md                  ← same rule, same counts
README.md                    ← Security section: the rule, not a Known Limitation
CLAUDE.md                    ← the principle as a Key decision; markdown-scan obligation grows
```

---

## 3. Module: `pipeline/forbidden-actions.ts` — design Q1

### 3.1 Responsibility

One answer to one question: *does this text declare an action a plan may not declare?* It is the
single source for the verb list, the verification exemption, the command pairs the guard uses,
and the prose the plan prompt teaches.

### 3.2 Key types

```ts
import { isLive, scanLines } from "./markdown-scan.js";

/** A prose verb. Matched whole-word with inflections — never as a substring (rule 5). */
export interface ForbiddenVerb {
  id: string;                 // "merge", "tag", "deploy", …
  kind: "verb";
  label: string;              // human wording for the refusal message
  pattern: RegExp;            // BUILT by inflect(); not hand-written
}

/**
 * A command form. `program`/`subcommand` is the shared datum (Q2): `forbidden-actions.ts`
 * builds `pattern` from it for scanning markdown, and `guard.ts` builds its own tokenised
 * match from the same pair. Neither restates the other's regex.
 */
export interface ForbiddenCommand {
  id: string;                 // "git-push", "gh-pr-create", …
  kind: "command";
  label: string;              // "`git push`"
  program: "git" | "gh";
  subcommand: string;         // "push" | "pr create" | "pr merge" | "release" | "workflow run"
  pattern: RegExp;            // BUILT from program + subcommand
}

export type ForbiddenAction = ForbiddenVerb | ForbiddenCommand;

export type MatchSource = "execute-table" | "gates-section" | "plan-gate";

export interface ForbiddenMatch {
  source: MatchSource;
  rowId?: string;             // "G1" — present for execute-table and plan-gate sources
  subject: string;            // the Name cell / bullet / heading name / checklist item, verbatim
  clause: string;             // the clause inside the subject that matched — what the message quotes
  actionId: string;           // which FORBIDDEN_ACTIONS entry hit
  line: number;               // 1-based, in the file it came from
}
```

### 3.3 Public surface

```ts
export const FORBIDDEN_ACTIONS: readonly ForbiddenAction[];
/** The `kind: "command"` subset, exported separately so `guard.ts` imports data, not a filter. */
export const FORBIDDEN_COMMANDS: readonly ForbiddenCommand[];
export const VERIFICATION_VERBS: readonly string[];      // confirm, check, verify, inspect
export const READ_ONLY_COMMANDS: readonly string[];      // git merge-base, git fetch, gh pr view, gh pr list

export function findForbiddenActions(text: string, source: MatchSource): ForbiddenMatch[];
export function describeForbiddenActions(matches: ForbiddenMatch[]): string[];
export const FORBIDDEN_ACTION_SPEC: string;              // built FROM the data above
```

`FORBIDDEN_ACTIONS` contents, from `01_product.md` §4.4:

| kind | entries |
|---|---|
| `verb` | `merge`, `push`, `open a PR` / `open PR` / `create a PR`, `close a PR`, `tag`, `release`, `deploy`, `publish` |
| `command` | `git push`, `gh pr create`, `gh pr merge`, `gh release`, `gh workflow run` |

### 3.4 The matching algorithm, in the order it runs

`findForbiddenActions` is given one text (a whole file, or one cell) and a source. For each
**subject** it extracts (§3.5), it runs:

```
subject
  │
  0. mask READ_ONLY_COMMANDS            rule 6 — `git merge-base`, `git fetch`,
  │   (blank them out, including          `gh pr view`, `gh pr list` are blanked BEFORE
  │    their arguments up to the next     splitting, so their own arguments cannot
  │    clause separator)                  become clauses
  │
  1. strip leading markup                list marker, `- [ ]`, `**`, backticks, `#` run
  │
  2. split into CLAUSES                  on  `,`  `;`  `→`  ` / `  ` then `  ` and `
  │                                      a bare `/` is NOT a separator (origin/x, docs/x.md)
  │
  for each clause:
  │  3. does it contain a kind:"command" pattern?      → REFUSE, never exempt (rule 3)
  │  4. does it contain a kind:"verb" pattern?
  │       └─ does the clause BEGIN with a VERIFICATION_VERB (after step 1's strip)?
  │            yes → exempt (rule 2)
  │            no  → REFUSE (rule 4: one non-exempt clause refuses the whole subject)
  │
  → ForbiddenMatch{ clause, actionId, rowId, line }
```

`inflect(verb)` builds the pattern: `new RegExp(String.raw`\b${verb}(?:s|ed|ing|d)?\b`, "i")`
with an irregular table for the handful that need one (`tag → tagging/tagged`,
`release → releasing/released`, `publish → publishes/published/publishing`). **Rule 5**: whole
word, so `staging`, `stage` and `package` never match `tag`. The product's own suggested reword
("configure the staging dashboard") depends on this, which is why the case table tests it twice.

The masking in step 0 is what keeps `git merge-base --is-ancestor origin/x main` — the
verification command the execute prompt teaches — from being read as a merge (rule 6).
`READ_ONLY_COMMANDS` is named **once**, here, and is the same list §5.2 preserves in the guard.

### 3.5 Subject extraction per source

| `source` | subjects scanned | `rowId` | Caller |
|---|---|---|---|
| `execute-table` | the `Name` and `Notes` cells of every `Owner = operator` row | the row's `Milestone` cell | `signOffPlaybook`, via `parseExecutionStatus` |
| `gates-section` | the bullets of the live `## Operator gates in this plan` section of `04_execute.md` | parsed from a leading `**G<n>**` if present | `signOffPlaybook` |
| `plan-gate` | every `## G<n> — <name>` heading's name part, and the `- [ ]` checklist items in its section | the `G<n>` | `signOffPlaybook`, plan-review warning |

**Design call.** The `execute-table` source takes **cells**, not raw text, so it needs a parsed
table. `findForbiddenActions(text, "execute-table")` would therefore have to re-parse. To avoid
a second parser, the module exposes one more narrow entry point:

```ts
export function findForbiddenActionsInRows(
  rows: Array<{ id: string; name?: string; notes?: string; owner: Owner; line: number }>,
): ForbiddenMatch[];
```

so `signOffPlaybook` passes rows it already parsed and `findForbiddenActions` keeps its
text-oriented signature for the two markdown sources. `Owner` is imported as a *type* from
`execute-table.ts` — a type-only import creates no runtime cycle, and the row shape is
structural, so `forbidden-actions.ts` does not gain a runtime dependency on the table parser.
If even the type import is judged too much coupling at review, the parameter type is inlined;
the behaviour is identical.

### 3.6 Scanning is live-lines-only

Every markdown path goes through `scanLines` + `isLive` (AC1.5). A forbidden verb inside a fence
or behind `> ` is inert here exactly as it is to both table readers. This is the property that
makes it safe for `FORBIDDEN_ACTION_SPEC` — which necessarily *contains* the words `merge` and
`push` — to be interpolated into a prompt whose output is later scanned.

An unterminated fence swallows the rest of the file, as CommonMark says it does. Per `CLAUDE.md`,
a caller that can be defeated that way names the stray fence rather than failing silently:
`describeForbiddenActions` therefore takes an optional `strayFence?: number` and, when the
caller's scan found an unclosed fence, appends one line naming it. `signOffPlaybook` passes it.
This matters here more than elsewhere: a stray fence makes a *refusal* silently pass.

### 3.7 `describeForbiddenActions` — the refusal lines

Per `01_product.md` §4.5 the message carries the whole remedy, because there is no override. One
block per refused subject, in the voice of the existing trailing-row message:

```
G1 | Merge PR #12 | operator  asks for a merge. A task's cycle ends at `done`; the merge is
yours to do afterwards. If this task *needs* #12's work, that is a dependency — sequence this
task after it, or base this branch on it — and it belongs in `03_plan_questions.md`, not in the
playbook. A gate may still check state that already exists if the row begins with a verification
verb, e.g. "Confirm tag v0.3.0 exists on the remote".
```

Three invariants the tests assert:

1. the row ID and the matched **clause** appear verbatim;
2. the rewrite hint is always present;
3. the hint's example is **never built from the refused subject**. It is the fixed string
   `Confirm tag v0.3.0 exists on the remote` — an already-true state. Offering "Confirm PR #12 is
   merged" would hand back the same dependency in a phrasing the check accepts (`01_product.md`
   §4.5), which is the one thing the message must not teach.

### 3.8 `FORBIDDEN_ACTION_SPEC` is generated

Built from `FORBIDDEN_ACTIONS` and `VERIFICATION_VERBS` by interpolation, the same rule
`EXECUTION_TABLE_SPEC` follows with its status and owner unions (`execute-table.ts`'s own
comment: *"Built FROM the unions above, never a hand-written copy"*). Adding a verb changes the
prompt, the refusal and the spec test in one edit. A test asserts every `FORBIDDEN_ACTIONS`
label appears in the rendered spec, so a future entry cannot be added without the prompt
learning it.

### 3.9 Stated residuals (design Q1, *Known residual*)

| Phrasing | Outcome | Why it is accepted |
|---|---|---|
| `Verify PR #12 is merged` | **passes** | A keyword check cannot tell state that already holds from state someone is waiting for. The mechanism for this case is the plan-review dependency question (§4), not this module |
| `Verify by merging PR #12` | **passes** | Rule 2 trusts the leading verb; it does not parse what follows. Listed so nobody mistakes the check for a parser |
| `Tag the screenshot with the build number` | **refused** | The accepted false positive. Cost: one reword, and the message supplies it |

---

## 4. Module: `pipeline/named-refs.ts` — design Q4

### 4.1 Responsibility

Given the task's own documents, find the branches and PRs they name **by identifier**, read each
one's current state with read-only commands, and render a short status block for
`planReviewPrompt`. It exists because a review session has `Read, Glob, Grep, Write` and the
guard denies Bash at all four review stages (`01_product.md` §4.3) — so the *handler* must do
what the prompt cannot ask the session to do.

### 4.2 Key types

```ts
export type NamedRef =
  | { kind: "pr"; number: number }
  | { kind: "branch"; name: string };

export type RefState =
  | "open" | "merged" | "closed"
  | "ancestor-of-main" | "not-ancestor-of-main"
  | "unknown";

export interface RefStatus {
  ref: NamedRef;
  status: RefState;
  /** Why it is `unknown`: "gh not on PATH", "timed out", "not a PR", "exit 1". Never third-party prose. */
  detail?: string;
}

export function findNamedRefs(text: string): NamedRef[];
export function resolveRefStatus(git: SimpleGit, refs: NamedRef[]): Promise<RefStatus[]>;
export function renderRefStatus(statuses: RefStatus[]): string;   // "" when there are none
```

### 4.3 What is scanned, and what counts as an identifier

**Scanned** (design Q4): `00_objective.md`, `01_product.md`, `02_design.md`, and
`03_plan_questions.md` once it has answers — the documents that exist *before* the session.
**Not** `03_plan.md`, which the session is about to write: a dependency named there for the first
time gets a question with no status attached. Accepted, because the alternative is a second pass
that appends statuses to a file the agent just wrote.

Live lines only, through `markdown-scan.ts` — the fourth consumer. An identifier inside a fence
or behind `> ` is inert here as everywhere else, which matters because this very document quotes
`PR #12` in several examples.

**Identifiers:**

| Form | Recognised | Note |
|---|---|---|
| `vibe-racer/NNNN_slug` | yes | matched on the branch-name shape `taskBranchName` produces |
| `PR #12`, `PR 12`, `pull request #12` | yes | the word `PR`/`pull request` is **required** |
| bare `#12` | **no** | in these documents `#6` is a task, and `#7` has been a follow-up, a GitHub issue and a task in the same week (design Q4) |

A missed status is a question without a fact attached — the pre-change behaviour. A wrong status
is a fact that is false, which is worse. Hence the asymmetry.

### 4.4 How status is read

| Ref kind | Command | Mapping |
|---|---|---|
| branch | `git rev-parse --verify <ref>` then `git merge-base --is-ancestor <ref> main` | exit 0 → `ancestor-of-main`; exit 1 → `not-ancestor-of-main`; no such ref → `unknown` (`detail: "no such ref"`) |
| PR | `gh pr view <n> --json state,mergedAt` | `state=MERGED` or `mergedAt` set → `merged`; `OPEN` → `open`; `CLOSED` → `closed`; anything else → `unknown` |

Four properties, each a hard requirement from design Q4:

1. **No `git fetch`.** Not because of the network, but because a fetch **writes**
   remote-tracking refs, and `drive` moving refs before a lap is a side effect nobody asked for.
   Branch status is read against what is already fetched.
2. **Every external call has a timeout** — `REF_LOOKUP_TIMEOUT_MS = 5_000`, and
   `MAX_REFS_RESOLVED = 10`. On timeout the child is killed and the status is `unknown` with
   `detail: "timed out"`. Without this a hung `gh` (an auth prompt, a dead proxy) stalls the lap
   before it starts and "failure is a status" is false.
3. **Failure is a status, never an error.** No `gh` on PATH, no network, a non-zero exit, a
   number that is an issue rather than a PR — all `unknown` with a `detail`. The lap runs on.
   `resolveRefStatus` has no rejecting path; its signature could be `Promise<RefStatus[]>` with
   no `throw` in the body, and a test asserts it by making every probe throw.
4. **Only state reaches the prompt.** `renderRefStatus` prints the identifier and the status
   enum and nothing else — never a PR title, body, author or branch description. That is
   third-party text, and putting it in a prompt is an injection path into a session. A dedicated
   test feeds a `gh` stub whose PR title contains `IGNORE PREVIOUS INSTRUCTIONS` and asserts the
   string never appears in the rendered prompt.

**Design call — how `gh` is invoked.** Not through `simple-git`, which only speaks git, and not
through the `Bash` tool, which does not exist outside a session. `node:child_process`'s
`execFile` with an argument array (never a shell string), `timeout` and `killSignal: "SIGKILL"`.
`execFile` without a shell also means a branch or PR identifier lifted out of a plan document
can never be interpreted as shell syntax — the identifiers are matched by a narrow pattern
first, and passed as a single argv element second. No new runtime dependency (`01_product.md`
§8.2).

### 4.5 What the prompt receives

`planReviewPrompt(ctx, round?, refStatus?)` gains a third optional argument, the way
`executeMilestonePrompt` gained its milestone: the handler computes, the prompt renders. With no
named identifiers `renderRefStatus` returns `""` and the block is **omitted, not printed empty**.

```markdown
## Dependencies named in this task's documents

These were read from the local repository before this session started. Read-only; nothing was
fetched or changed.

- `PR #12` — open
- `vibe-racer/0004_fasten-dead-code` — not an ancestor of `main`
- `PR #19` — unknown (gh not on PATH)

For each one that this plan actually depends on, raise a question in `03_plan_questions.md` with
the two legitimate answers: **sequence** this task after it, or **base** this branch on it.
Never plan a gate row that merges it.
```

---

## 5. Changes to `claude/guard.ts` — design Q2

### 5.1 The new constant

```ts
import { FORBIDDEN_COMMANDS } from "../pipeline/forbidden-actions.js";

/**
 * The remote writes an execute session is told not to make, now denied rather than discouraged.
 * A SEPARATE constant from BASH_BLOCKLIST on purpose: the count `formatGuardSummary` and the
 * three security documents state stays a deliberate number rather than a side effect (AC2.4).
 *
 * The data comes from `pipeline/forbidden-actions.ts` — the same `{program, subcommand}` pairs
 * the plan check refuses — so "what a plan may not ask for" and "what a session may not run"
 * cannot drift. The regexes do not come from there: a pattern written for a sentence is the
 * wrong tool for `cd repo && git -C . push`.
 */
const REMOTE_WRITE_DENYLIST: ReadonlyArray<{ program: string; subcommand: string }> =
  FORBIDDEN_COMMANDS.map(({ program, subcommand }) => ({ program, subcommand }));

const REMOTE_WRITE_DENIED_STAGES: Set<Stage> = new Set(["ready_to_execute"]);
```

### 5.2 Where the subcommand search stops

`checkBashCommand` today splits on whitespace and shell delimiters and compares one word at a
time. It has no notion of a subcommand and does not respect quotes, so "a `push` somewhere after
`git`" would deny `git commit -m "fix push logic"` — and an execute lap commits constantly. The
rule (design Q2):

```ts
/** `git`/`gh` invocations in a command line, one per shell segment. */
interface Invocation { program: string; subcommand: string; }

function parseInvocations(command: string): Invocation[] {
  // 1. split into SEGMENTS on  ;  &&  ||  |  &  newline  $(
  // 2. per segment: drop leading `VAR=value` assignments, take the first word as the program
  //    (basename, so `/usr/bin/git` matches)
  // 3. the subcommand is the FIRST word that is not an option, skipping the argument of git's
  //    value-taking global options: -C, -c, --git-dir, --work-tree, --namespace
  // 4. for `gh`, take that word AND the next (`pr create`, `workflow run`)
  // 5. nothing after the subcommand is ever looked at
}
```

Step 5 is the whole safety property: a commit message, a branch named `push`, or a path cannot
match.

| Command | Outcome |
|---|---|
| `git push -u origin HEAD` | **denied** |
| `cd repo && git -C . push` | **denied** |
| `git -c user.name=x push` | **denied** |
| `gh pr create --fill`, `gh pr merge 12`, `gh release create v1`, `gh workflow run ci` | **denied** |
| `git commit -m "fix push logic"` | allowed — subcommand is `commit` |
| `git log --grep push` | allowed — subcommand is `log` |
| `git fetch`, `gh pr view 12`, `gh pr list` | **allowed** (AC2.2, hard requirement) |
| `sh -c "git push"`, `eval "$cmd"`, `./script.sh` | **allowed — stated residual** |

The allowances are `READ_ONLY_COMMANDS` from §3.3: the same list, named once. A matching test
asserts `READ_ONLY_COMMANDS` and `REMOTE_WRITE_DENYLIST` are disjoint, so a future entry cannot
silently break gate verification.

### 5.3 Where the rule sits in `canUseTool`

In the Bash branch, **beside** the existing `BASH_BLOCKLIST` check and **after** Rule 4b (review
stages may not shell out at all), scoped by `REMOTE_WRITE_DENIED_STAGES`. It denies through the
existing `deny()` closure, so it is logged and written to `.vibe-racer/audit.log` by the same
path as every other denial (AC2.1), with no new audit code.

Ordering within the Bash branch is `REMOTE_WRITE_DENYLIST` **first**, then `BASH_BLOCKLIST`, then
the interpreter and path checks. Reason: a `git push` to a path outside the project should be
reported as a push, not as a path violation — the message the operator reads should name the rule
that actually matters.

### 5.4 The denial message (AC2.3)

```
Denied: Bash 'git push -u origin HEAD' — `git push` is denied in an execute session. Pushing,
opening PRs, merging, tagging, releasing and deploying are the operator's, after the task reaches
`done`.
```

Built from the matched entry's `label`, so a new entry gets a correct message for free.

### 5.5 `formatGuardSummary`

Gains one clause, mirroring the Rule condition exactly — the discipline the existing comment
already demands (*"a banner that says path-jail to ./ while writes are actually jailed is the
same defect class as a script that prints PASS without testing anything"*):

```
Guard: path-jail to ./  ·  tools: [Read, …]  ·  bash: 18 commands blocked  ·  remote writes: 5 denied
```

The `remote writes:` clause is printed **only** when `REMOTE_WRITE_DENIED_STAGES.has(stage)`, for
the same reason: a banner that claims an inactive rule is decoration.

### 5.6 What this milestone does not claim (`01_product.md` §5.4)

`gh` itself is not denied — five commands are. Two residuals, documented rather than papered
over: `gh api -X PUT repos/…/pulls/12/merge` still writes to the remote, and a command inside
another shell (`sh -c`, `eval`, a script file) is an argument to the guard, not a command, and
the guard does not look inside. The three security documents therefore say *"denies `git push`,
`gh pr create`, …"* and never *"cannot push"* (AC2.4).

**This milestone is inert without the prerequisite task.** A deny list added to a guard that is
never called denies nothing. The assumption — the hook runs under `bypassPermissions`, a tool
outside the lap's list is denied, denials reach the audit log — is checked at the top of the plan
lap (AC0.1), not assumed.

---

## 6. Changes to `state/advancement.ts` — design Q1

### 6.1 `signOffPlaybook` gains CHECK B

`signOffPlaybook(filePath)` keeps its shape — returns `false` only to block the tick — and gains
a second blocking check. Kept as a **separate function** from `trailingOperatorRows`: they answer
different questions (position vs content) and the product keeps them as two distinct checks with
two distinct messages (design Q1).

```
         operator ticks "Ready to advance to Execution" in 04_execute.md
                                   │
                    parseExecutionStatus(04_execute.md)
                       │                        │
                  throws                     parses
                       │                        │
         warn + table checks skipped            │
         (tick honoured, AC1.7)                 │
                       │                        │
                       ├────────────────────────┤
                       │                   CHECK A  trailingOperatorRows (existing)
                       │                        │ hit → untick, name rows, return false
                       │                        │
                       │                   CHECK B  forbidden actions in operator ROWS
                       │                        │     + the "Operator gates in this plan" section
                       │                        │
                       └──────────┬─────────────┘
                                  │
                   CHECK B (cont.) forbidden actions in 03_plan.md's `## G<n>` headings
                                  │ and checklists — runs REGARDLESS of the table parse (AC1.7)
                                  │ 03_plan.md missing/unreadable → warn, skip this half (§9.2)
                                  │
                      any hit → removeCompletionMarker, print describeForbiddenActions, false
                                  │
                        announce the gate count (existing)
                                  │
                           advance to ready_to_execute
```

New signature detail: `signOffPlaybook` needs the plan file too, so it takes the plan **folder**
rather than one file path — `signOffPlaybook(planDir: string): boolean`, resolving
`04_execute.md` and `03_plan.md` itself. `tryAdvance` already has `path.join(cwd, planPath)`.

### 6.2 Status-blind, exactly as CHECK A is

Both checks ignore the `Status` cell. Before execution a `done` cell is the plan author claiming
something rather than the pipeline observing it; honouring it would make "mark the row done" the
way around a check whose whole job is keeping that work out of the table
(`advancement.ts`'s existing comment, and `01_product.md` §7.4).

### 6.3 Agent rows are not scanned (AC1.6)

CHECK B looks at `Owner = operator` rows only. A forbidden verb in an agent row is the task's own
work: the Bash deny list (§5) is what stops the agent acting on it, and the prompt is what stops
it being written. Refusing there would refuse the sign-off of a plan whose milestone is literally
"make the guard deny `git push`" — this task's own.

### 6.4 Three properties of the refusal (`01_product.md` §4.5)

1. **The box is unticked** via the existing `removeCompletionMarker`, so the task holds at
   `need_execution`. No lap starts, nothing is spent.
2. **Every refused row is named**, with its matched clause.
3. **The message always carries the rewrite hint** — there is no override, so the message is the
   whole remedy.

Re-ticking without editing refuses again, identically: the check is deterministic and stateless
(`01_product.md` §9.2).

### 6.5 Nothing in `tryAdvance` starts throwing

`tryAdvance` runs inside `drive`'s task loop. After M3 that loop runs for one task, but the
discipline holds: `signOffPlaybook` catches its own parse errors and `describeForbiddenActions`
is pure. A missing `03_plan.md` warns and skips; it never strands a ticked box.

---

## 7. Changes to `git/operations.ts` — design Q3

Three additions, all read-only except the branch creation `ensureBranch` already does.

```ts
/**
 * One file's contents at a ref, without touching the index or the working tree.
 *
 * `null` means "the ref exists and the path does not" — a plan folder that has not reached that
 * branch yet, which is the common case on `main`. Anything else THROWS: a bad ref, a corrupt
 * object or a missing repository is not the same answer as "no such file", and conflating them
 * would make a broken repository look like a fresh task.
 */
export async function readFileAtBranch(
  git: SimpleGit,
  ref: string,
  repoRelPath: string,
): Promise<string | null>;        // git show <ref>:<path>

/**
 * Remote-tracking refs for one task branch, e.g. ["refs/remotes/origin/vibe-racer/0005_x"].
 * Reads refs already fetched — `git for-each-ref`, no network. `origin` first when present,
 * then alphabetical, so the choice is deterministic across a repo with several remotes.
 */
export async function listRemoteTaskRefs(
  git: SimpleGit,
  branchName: string,
): Promise<string[]>;

/** The dirty-tree answer plus the paths, in git's own `XY path` shape (AC3.3). */
export async function treeStatus(
  git: SimpleGit,
): Promise<{ clean: boolean; entries: string[] }>;
```

**On `readFileAtBranch`'s error discrimination.** `git show` writes
`fatal: path 'x' exists on disk, but not in 'ref'` or `fatal: path 'x' does not exist in 'ref'`
for the `null` case, and `fatal: invalid object name` / `unknown revision` for the throw case.
The implementation matches the "not in" / "does not exist in" wording and rethrows otherwise;
both branches are covered by tests with the real messages, so a future git wording change fails
loudly rather than turning every task into "first drive". **This is the single most fragile
string in the milestone and the one to re-check when the CI image's git version moves.**

**On `treeStatus`'s shape.** `repoSnapshot` already collects dirty paths, but flattens them to
bare paths for the execute loop's "did anything happen" question. The refusal message must print
`M  src/claude/guard.ts` / `?? notes.md` — the operator reads the two-letter code to decide
between commit and stash. `treeStatus` therefore maps `simple-git`'s `status.files` (which
carries `index` and `working_dir` chars) rather than reusing `repoSnapshot`, and
`repoSnapshot` is left alone: two callers, two questions, and merging them would give the
execute loop a shape it does not want.

**`currentBranch`'s doc comment changes.** It says today that its only caller is `drive`'s
nothing-to-do hint, *"so it never throws"*. After M3 it is load-bearing in `ensureBranch`. It
keeps its non-throwing contract — `""` on a detached HEAD or an unborn branch — and `ensureBranch`
treats `""` as "not the task branch", i.e. a switch, which triggers the dirty check and the
checkout. The comment is rewritten to say that, because a future reader finding the old one
would reasonably assume the function is still cosmetic.

---

## 8. Changes to `state/discovery.ts` — design Q3

### 8.1 What stays

`discoverTasks(plansDir)` is **unchanged**: sync, no git, folder names + the working tree's
`state.yml`, invalid folders skipped. `pitwall` and `new` depend on exactly that, and the folder
names are shared across branches anyway.

### 8.2 What is added

Design Q3 puts the per-task resolution step in `discovery.ts`. It cannot live *inside*
`discoverTasks`, which is synchronous and git-free; it is therefore a second exported function
in the same module — the same shape, one layer up:

```ts
export type StateSource = "working-tree" | "branch" | "remote-ref";
export type BranchState  = "current" | "local" | "remote-only" | "missing";

export interface ResolvedTask extends Task {
  /** The branch this task's state was read from, or would be read from. */
  branch: string;
  branchState: BranchState;
  source: StateSource;
  /** `refs/remotes/origin/vibe-racer/…` when `branchState === "remote-only"`. */
  remoteRef?: string;
  /** The stage as read from `source` — NOT necessarily the working tree's. */
  stage: Stage;
  /** The stage's questions file as read from `source`; `null` when absent there. */
  questionsContent: string | null;
  /** Set when the tick was found only as an uncommitted working-tree edit (§8.4). */
  tickSource?: "branch" | "working-tree";
}

export async function resolveTaskSources(
  git: SimpleGit,
  tasks: Task[],
  opts: { cwd: string; plansDir: string },
): Promise<ResolvedTask[]>;
```

### 8.3 The source-selection decision table

Evaluated per task, in this order (design Q3 step 2). The **order matters**: the remote-ref check
comes before the stage is consulted, because the stage on the current branch proves nothing —
the pipeline commits stage changes on the task branch, so on `main` a task's `state.yml` says
`need_objective` for its whole life (verified for #6).

| # | Condition | `branchState` | `source` | Rationale |
|---|---|---|---|---|
| 1 | the task's branch **is** the current branch | `current` | `working-tree` | **Non-negotiable.** The operator's tick is usually *uncommitted* on the branch they are standing on, and `git show` would miss it. This is the common "edit a plan file and drive" loop |
| 2 | the local branch exists and is not current | `local` | `branch` | `readFileAtBranch` for `state.yml` and the stage's questions file — plus one look at the working tree (§8.4) |
| 3 | no local branch, a remote-tracking ref exists | `remote-only` | `remote-ref` | A fresh clone, or a local branch deleted after a push. Without this, `ensureBranch` would cut a new local branch from `main` that diverges from the one on the remote |
| 4 | no branch anywhere, working-tree stage is `need_objective` | `missing` | `working-tree` | First `drive`. The signal is **the stage** — the one `createPlanFolder` writes and nothing but the pipeline changes — never the folder listing: an operator who drops a mock-up beside the objective must not turn a new task into a "missing branch" |
| 5 | no branch anywhere, working-tree stage is past `need_objective` | `missing` | `working-tree` | A task whose branch was deleted after its merge. **`ensureBranch` refuses rather than creating it** (§10.3) |

**Stated limit** (`01_product.md` §9.3): a branch that exists on the remote but was never fetched
is invisible, and the task is taken for case 4 or 5. `drive` makes no network call to find out;
the remedy is `git fetch` before `drive` on a clone that may be behind, and it is documented, not
worked around.

### 8.4 The uncommitted-tick look (case 2 only)

For a task read from its branch, `resolveTaskSources` also asks: is the working-tree copy of that
same questions file **modified** (per `treeStatus`) *and* does it carry the tick? If so the task
is a candidate anyway, with `tickSource: "working-tree"`.

This exists for one scenario and is worth the complexity for it: the operator's dirty file *is*
the ticked questions file, on `main`. Without the look, the tick is invisible, the outcome is
"nothing to do" with no message, and `01_product.md` §9.3's *"the message names it"* is false.
With it, §10.3's dirty-tree refusal fires and names the file. It is narrow — most questions files
do not exist on `main` at all — but it is the one case where silence is the wrong answer.

### 8.5 Two pure helpers this needs

Reading state and ticks from a **string** instead of a path needs the pure half of two existing
functions. Both are extractions, not copies — the disk version is reimplemented in terms of the
string version, so they cannot drift, and a test asserts the disk function's result equals the
string function's on the same bytes:

| New | Existing, rewritten to call it |
|---|---|
| `parseStateContent(raw: string): TaskState` in `state/store.ts` | `readState(planPath)` = `parseStateContent(readFileSync(...))` |
| `hasCompletionMarkerIn(content: string): boolean` in `pipeline/validation.ts` | `hasCompletionMarker(filePath)` = `hasCompletionMarkerIn(readFileSync(...))` |

---

## 9. Module: `state/actionable.ts` — design Q3

### 9.1 Responsibility

Turn `ResolvedTask[]` into the candidate set `01_product.md` §7.2 step 2 defines. `drive` and
`pitwall` both want it; it gets a home outside `drive.ts` from the start.

```ts
export type ActionableReason = "agent_stage" | "ticked" | "error_retry";

export interface Candidate {
  task: ResolvedTask;
  reason: ActionableReason;
}

export function buildCandidates(
  tasks: ResolvedTask[],
  opts: { retry: boolean },
): { actionable: Candidate[]; waiting: ResolvedTask[] };
```

### 9.2 The predicate

A task is actionable if, **read from its own branch**:

| Reason | Condition |
|---|---|
| `agent_stage` | `isAgentStage(stage)` — no tick to read |
| `ticked` | `isHumanStage(stage)` and the stage's `(file, markerText)` pair is ticked in `questionsContent` |
| `error_retry` | `stage === "error"` and `--retry` was given |

**"Ticked" must mean exactly what `tryAdvance` means by it**, or `drive` promises a lap it then
refuses. So the predicate reuses the readers, not a new regex:

- `need_operator` → `readPauseBlockState(content)?.markerTicked === true` (the pause has its own
  marker and its own block scan; the generic marker is already ticked in that same file from
  sign-off, which is precisely why only the last block is ever read);
- every other human stage → `hasCompletionMarkerIn(content)`.

`actionable` is sorted by task number, so "the first actionable" is deterministic.

### 9.3 The candidate set is advisory; `tryAdvance` is authoritative

`buildCandidates` reads; it never writes. After the checkout, `tryAdvance` re-reads the same file
from disk and makes the real decision — including `validateAnswers`, the decision checklist, and
CHECK A/CHECK B. A candidate can therefore legitimately fail to advance (incomplete answers, a
forbidden gate row, an outstanding pause item). That is not a bug: `drive` reports the refusal and
stops, with the operator standing on the branch whose file they must edit. This preserves the
`CLAUDE.md` rule that **every command re-reads state from disk** — the candidate pass is a
cheap filter over other branches, not a cache.

---

## 10. Changes to `cli/drive.ts` — design Q3

### 10.1 The six named steps

`driveCommand` becomes `01_product.md` §7.2 as six functions in one file, each testable:

```ts
export async function driveCommand(opts: { task?: number; retry?: boolean }): Promise<void> {
  await checkPrerequisites();
  const config = loadConfig(cwd);
  const git = createGit(cwd);

  const resolved = await resolveTaskSources(git, discoverTasks(plansDir), { cwd, plansDir: config.plans_dir });
  const { actionable, waiting } = buildCandidates(resolved, { retry: opts.retry === true });

  const chosen = await selectTask({ /* existing helper, filtered to `actionable` */ });
  if (!chosen) { reportNothingToDo(waiting); return; }          // step 8, nothing-actionable half

  const prepared = await ensureBranch(git, chosen);             // steps 4 + 5
  if (!prepared.ok) { log.error(prepared.message); return; }    // refusal: no session, tree untouched

  const target = await advanceSelected(chosen, cwd);            // step 6, THIS TASK ONLY
  if (target === null) { report(chosen, actionable); return; }  // refused/not advanced
  if (target === "done") { await finalizeTask(...); report(...); return; }

  await dispatch(target, ctx);                                  // step 7
  report(chosen, actionable);                                   // step 8
}
```

### 10.2 `selectTask` is reused unchanged

`cli/task-select.ts` already does `--task N`, the single-match info line, the interactive
`select` for several, `notFoundMessage` and `ineligibleMessage`. It is given the candidate list
and keeps every message, including the `need_operator` wording that says *"paused waiting on the
operator"*, never *"error"* (`01_product.md` §9.3). Its `filter: (stage) => boolean` signature
takes a stage, so the call site passes a filter closed over the candidate numbers rather than a
new stage predicate — a one-line change, not a rewrite.

### 10.3 `ensureBranch` — the checkout and the dirty-tree policy

```ts
type Prepared = { ok: true; switched: boolean } | { ok: false; message: string };
async function ensureBranch(git: SimpleGit, c: Candidate): Promise<Prepared>;
```

| `branchState` | tree | Action |
|---|---|---|
| `current` | **any** | No checkout. Proceed without looking at the tree at all (AC3.4) |
| `local` | clean | `git checkout <branch>` |
| `local` | dirty | **REFUSE**, naming the paths (AC3.3) |
| `remote-only` | clean | `git checkout -b <branch> <remoteRef>`, and say which ref it came from |
| `remote-only` | dirty | **REFUSE**, naming the paths |
| `missing` + stage `need_objective` | **any** | `git checkout -b <branch>` from the current HEAD, as today |
| `missing` + stage past `need_objective` | any | **REFUSE**: name the missing branch and how to recreate it |

**Design call — why the first-`drive` creation does not check the tree.** Creating a branch at the
current HEAD and checking it out does not change one byte of the working tree: it is a label, not
a switch. §6.2's rule is *"the check is about switching branches"*, and refusing here would break
`vibe-racer new` → edit objective → `drive`, which is the first thing every user does. The
pre-existing hazard that `commitAll`'s `git add .` then sweeps unrelated dirty files into the
task's first commit is **unchanged by this task** and recorded in §19.3 — not silently fixed
inside a milestone about branch switching.

The two refusal messages:

```
Task #6 needs branch vibe-racer/0006_drive-enforcements, but you have uncommitted changes:
  M  src/claude/guard.ts
  ?? notes.md
Commit or stash them, then run `vibe-racer drive` again.
```

```
Task #6 is at [need_execution], but branch vibe-racer/0006_drive-enforcements does not exist —
locally or on any remote you have fetched. It was probably deleted after a merge.
vibe-racer will not create it from the branch you are on: that would cut it from another task's
work. Recreate it from the right start point, then run `vibe-racer drive` again:
  git branch vibe-racer/0006_drive-enforcements <start-point>
```

A checkout that fails for any other reason — conflict, locked index, detached HEAD — reports git's
error **verbatim**, names the branch, and starts no session (`01_product.md` §9.3). `ensureBranch`
catches, it does not let `simple-git`'s error escape to a stack trace.

### 10.4 `advanceSelected`

```ts
async function advanceSelected(c: Candidate, cwd: string): Promise<Stage | null>;
```

Runs **after** the checkout, for the selected task only. It is today's loop body with the loop
removed: `tryAdvance`, the `resumed` vs `advanced` wording, the `done` → `finalizeTask` hand-off,
the `no_questions_file`-at-`need_operator` warning, and the `error` + `--retry` stage rewrite
(`validStage` + `updateStage`). Returns the stage to dispatch, or `null` when nothing should be
dispatched.

`finalizeTask` keeps its `checkoutBranch` call. It is now redundant — `ensureBranch` has already
checked out — but it is also reached from a path where being wrong is expensive, and a second
checkout of the branch you are on is a no-op. **Design call: leave it**, with a one-line comment
saying `ensureBranch` is the real guarantee. Deleting it is a reasonable alternative and a
plan-lap call; it is not worth a behaviour risk in a milestone about branch correctness.

### 10.5 `report` — the closing output

Three lines, in this order (`01_product.md` §6.3, §6.4):

```
You are now on vibe-racer/0006_drive-enforcements.
Next: review plans/0006_drive-enforcements/01_product_questions.md and tick the checkbox.
Also actionable: #7 (ready_to_execute), #9 (ai_qa).
Run `vibe-racer drive` again to take the next one, or `drive --task 7` to pick.
```

- **"You are now on …"** states §6.4's decision as a promise rather than leaving it a side
  effect. `drive` does **not** restore the operator's original branch: the lap just wrote the
  documents their next action is to read.
- **"Next: …"** is derived from the stage the task is at *after* dispatch, via
  `STAGE_QUESTIONS_FILE` + `STAGE_NEXT_NAME` — the same pair the "Waiting on human input" list
  already uses, so there is one source for "what the operator does next".
- **"Also actionable: …"** is the other candidates, by number and stage. This line is what makes
  one-task-per-run deliberate rather than arbitrary; without it, "run drive again" is folklore.
  Printed only when there are others.

On an error after the checkout, the error output says the operator is on the task branch and that
this is where the evidence is.

### 10.6 `branchHint` is deleted (AC3.7)

Its whole job was explaining why a paused task looked idle from `main`. After M3 that cannot
happen, and a hint describing an impossible situation teaches the operator something false about
how the tool works (`01_product.md` §6.5). `getVibeRacerBranches` keeps its `pitwall` caller and
stays.

---

## 11. Prompt surface changes — M1

| Surface | Change | Criterion |
|---|---|---|
| `planReviewPrompt` gate categories | "merging a prerequisite PR" and "running a workflow" removed. Remaining: code review, credentials or secrets, an external service or dashboard, a manual visual or screenshot check, a soak or wait period, anything outside the repository a following milestone needs | §4.2 |
| `planReviewPrompt` | interpolates `FORBIDDEN_ACTION_SPEC` — the principle in words, plus the two legitimate dependency answers (**sequence** / **base**) | §2 |
| `planReviewPrompt` | gains the optional `refStatus` block (§4.5) | §4.3 |
| `EXECUTION_TABLE_SPEC` worked example | `G1 \| Operator merges PRs #12 and #14` → `G1 \| Operator confirms the staging dashboard shows the new metric` | AC1.3 |
| `PAUSE_BLOCK_SPEC` worked example | the merge checklist → a manual visual check. **Stays fenced** when interpolated (`CLAUDE.md`) | AC1.3 |
| `PAUSE_BLOCK_SPEC` item 6 | the closing line loses the branch (§12) | AC3.7 |
| `executeMilestonePrompt` | **unchanged except by inheritance.** Gate verification keeps `git fetch`, `git merge-base` and `gh pr view`; "you never push, open PRs, merge PRs or deploy" stays. These are exactly the commands §5.2 preserves | §4.2 |
| `qaPrompt` | signature becomes `qaPrompt(ctx)`. The "Operator gates this task paused at" section and the mandatory coverage statement are **deleted** | AC1.8 |

The replacement `EXECUTION_TABLE_SPEC` example earns its keep twice over: "staging" is a live
proof of §3.4 rule 5 (whole-word `tag` does not match `staging`), so the spec the prompt teaches
is itself a case the checker must pass. The AC1.3 test renders both specs and both prompts and
asserts `findForbiddenActions` returns `[]` over the gate examples — the generated spec checked by
the generated checker, with no hand-maintained word list in the test.

---

## 12. Changes to `pipeline/operator-block.ts` — M3 signposting

The closing line was #5's workaround for `drive` reading the wrong branch. M3 removes the reason
for it (`01_product.md` §6.5).

```ts
const CLOSING_LINE = "When done, tick every box above and run `vibe-racer drive`.";

/**
 * The pre-#6 form. Still RECOGNISED — never written — so a pause block already in a file is
 * found, normalised and resumed (AC3.7, §8.3 backward compatibility).
 */
const LEGACY_CLOSING_PREFIX = "When done, switch back to branch";
const CLOSING_PREFIXES = ["When done, tick every box above", LEGACY_CLOSING_PREFIX];
```

- `closingLine()` loses its `branchName` parameter and becomes the constant.
- `PauseBlockInput.branchName` is **removed**, as is `branchName` from `normalisePauseBlock`'s
  `ctx`. `handlers/execute.ts` stops passing it. ("Delete what you replace" — the field would
  otherwise sit unread and be re-wired by the next person who sees it.)
- The finder in `normalisePauseBlock` matches **either** prefix, and rewrites whatever it finds
  to `CLOSING_LINE`. So a legacy block is upgraded the next time it is normalised, and a legacy
  block that is never re-paused still resumes — resume reads the marker and the checkboxes, never
  the closing line.
- `PAUSE_BLOCK_SPEC` item 6 and its worked example use the new wording.

Where the branch name is a **fact** rather than an instruction it stays: `finalizeTask`'s
"Merge `vibe-racer/…` when ready", and `report`'s "You are now on …". The operator needs the name
to merge; they no longer need it to drive.

---

## 13. Handler changes

### 13.1 `handlers/plan-review.ts` — two new jobs, zero changes to the shared runner

The other three review handlers share `handleReviewWithRounds` and **must not** start shelling
out (design Q4, *Scope*). So the two additions bracket the shared call rather than entering it:

```ts
export async function handlePlanReview(ctx: TaskContext): Promise<void> {
  // BEFORE the session: resolve dependency status. Never throws (§4.4 property 3).
  const refBlock = await resolveNamedRefBlock(ctx);

  await handleReviewWithRounds({
    ctx,
    stage: "ai_plan_review",
    promptFn: (c, round) => planReviewPrompt(c, round, refBlock),   // closure, not a new field
    /* …everything else unchanged… */
  });

  // AFTER the session: warn about forbidden actions in what it just wrote (§4.3).
  warnForbiddenActions(ctx);
}
```

- **`promptFn` is a closure.** `ReviewConfig.promptFn` is already
  `(ctx, round?) => { prompt; persona }`; binding `refBlock` into it needs no change to
  `review-runner.ts`. The status is resolved once per handler invocation — which is once per
  round, since each `drive` of `ai_plan_review` is one round. A status read in round 1 would be
  stale by round 2, so it is read again each time (design Q4).
- **`warnForbiddenActions` never blocks and never edits.** It runs
  `findForbiddenActions` over `03_plan.md` and `04_execute.md` if they exist and prints
  `describeForbiddenActions` as warnings — at the moment the operator is about to read the plan.
  It does not fail the lap. Blocking stays `signOffPlaybook`'s job (`01_product.md` §4.3).
- **Placement after the call, not in a `finally`.** If `handleReviewWithRounds` throws, the task
  is in `error` and there is no plan for the operator to read; a warning then is noise. On the
  follow-up-questions path there is no plan either, and `warnForbiddenActions` finds nothing to
  scan — it is a no-op, not a special case.
- The forced-re-run path inside the runner calls `forcedSpecPrompt`, which takes no `refStatus`.
  That is correct: at the cap the session must produce the plan, and the dependency block is
  guidance for writing questions.

### 13.2 `handlers/qa.ts` — `gatesPassed()` deleted

`gatesPassed`, its `readFile`, its `parseExecutionStatus`/`operatorGates` imports, its warning,
and the `gates` argument to `qaPrompt` all go (AC1.8). With no gate able to merge, nothing leaves
`git diff main...HEAD` mid-cycle and the coverage statement has no instance. The QA handler's
turn-limit salvage, `ensureCompletionSection`, stage write and commit are untouched.

Existing `05_qa.md` reports keep their coverage statements as history (`01_product.md` §8.3) —
this is a prompt change, not a migration.

---

## 14. Integration Patterns

### 14.1 The Claude Code SDK

Unchanged by this task. `runAndStream` keeps `permissionMode: "bypassPermissions"` and
`settingSources: ["project", "user"]`; whether the guard is *consulted* is the prerequisite
task's subject (`01_product.md` §3). This task adds a rule to `createToolGuard`'s decision
function and tests **that function**, never a transport by hand — the prerequisite's lesson
(design Q2).

### 14.2 `git`, via `simple-git`

| Operation | Call | Writes? |
|---|---|---|
| read a file at a ref | `git.show(["<ref>:<path>"])` | no |
| list remote-tracking refs | `git.raw(["for-each-ref", "--format=%(refname)", "refs/remotes"])` | no |
| dirty tree + codes | `git.status()` | no |
| ancestry | `git.raw(["merge-base", "--is-ancestor", a, b])` | no |
| checkout / create | existing `checkoutBranch`, plus `git.checkoutBranch(name, startPoint)` for the remote-only case | yes (HEAD, tree) |

**No `git fetch` anywhere in this task.** A fetch writes remote-tracking refs, and `drive`
moving refs before a lap is a side effect nobody asked for (design Q4). The cost is §8.3's stated
limit, and the limit is documented.

### 14.3 `gh`, via `node:child_process`

Only `named-refs.ts`, only `gh pr view <n> --json state,mergedAt`, only from the plan-review
handler. `execFile` with an argv array (no shell), a 5-second timeout, `SIGKILL` on expiry, and
every failure mapped to `unknown` + `detail`. **This is the first network call `drive` makes
outside a session**, and that is stated rather than discovered: it is read-only, bounded, skipped
when `gh` is absent, and it changes nothing in the repository (`01_product.md` §4.3).

### 14.4 The markdown contract

Four modules now read plan markdown, and all four go through `markdown-scan.ts`. The rule is
unchanged and the obligation is wider: a heading, table row, bullet or checkbox inside a fence or
behind `> ` is inert to **all four**. `CLAUDE.md`'s *One markdown reader* decision is updated to
name the two new consumers and to say that a change there now requires the four-playbook
equivalence check plus both new case tables.

---

## 15. State Management Design

### 15.1 The machine does not move

`STAGE_ORDER`, `NON_LINEAR_STAGES`, the `need_operator` detour and `STAGE_QUESTIONS_FILE` are
untouched (`01_product.md` §7.1). `need_operator` still lives outside `STAGE_ORDER`, still
returns to `ready_to_execute`, and still keeps the resume marker
`Operator actions complete — resume execution` rather than a "Ready to advance …" line — the
issue-#3 stale-tick guard that `states.test.ts` enforces. This task changes **what refuses**,
**where it is enforced** and **which branch is checked out**, not the shape of the machine.

### 15.2 `state.yml` stays pipeline-owned

No new fields. Guard Rule 0 is untouched. Nothing this task adds is written by an agent: the
sign-off refusal is `signOffPlaybook`, the stage write is `updateStage`, the pause write is
`pauseForOperator`, and the branch decision is `drive`'s.

### 15.3 The new state dimension: *which tree answered*

M3 introduces a question the pipeline never had to ask: **which copy of a plan file is the truth
right now?** It is answered per task, by `resolveTaskSources` (§8.3), and recorded on
`ResolvedTask` as `source` + `branchState` + `tickSource`. Three invariants:

1. **The current branch always wins.** An uncommitted tick on the branch you are standing on is
   the truth, and `git show` cannot see it.
2. **The resolution is read-only and is never cached across a run.** One pass, then the checkout,
   then `tryAdvance` re-reads from disk. Every command still re-reads state from disk
   (`CLAUDE.md`).
3. **The resolution never writes.** Not a ref, not the index, not the tree. The only write in the
   whole M3 path is the checkout `ensureBranch` performs on a task the operator has already been
   selected — and, for `remote-only`, the local branch it creates from the remote ref.

---

## 16. Data Flow

### 16.1 Sign-off: `need_execution` → `ready_to_execute`

```
operator ticks "Ready to advance to Execution" in 04_execute.md
  │
drive → ensureBranch (checkout) → advanceSelected → tryAdvance
  │
  ├─ hasCompletionMarker ✓
  ├─ validateAnswers ✓
  └─ signOffPlaybook(planDir)
       ├─ parseExecutionStatus(04_execute.md)              [execute-table.ts]
       ├─ CHECK A  trailingOperatorRows                    → untick + 3 warn lines + false
       ├─ CHECK B  findForbiddenActionsInRows(operator rows)
       │           findForbiddenActions(gates section, "gates-section")
       │           findForbiddenActions(03_plan.md, "plan-gate")
       │             └─ markdown-scan: live lines only
       │             └─ mask READ_ONLY_COMMANDS → clauses → verb/command → verification verb?
       │           hit → removeCompletionMarker + describeForbiddenActions + false
       └─ announce gate count → updateStage(ready_to_execute)
```

### 16.2 Guard: an execute session runs `git push`

```
session → Bash("git push -u origin HEAD")
  │
PreToolUse hook (prerequisite task) → createToolGuard(...)(toolName, input)
  │
  ├─ PATH_TOOLS?            no
  ├─ Rule 4b review stage?  no (ready_to_execute)
  └─ Bash branch
       ├─ REMOTE_WRITE_DENYLIST  ← parseInvocations → {git, push} → MATCH
       │     └─ deny()  → log.warn + appendAuditEntry(.vibe-racer/audit.log) + behavior:"deny"
       ├─ BASH_BLOCKLIST              (not reached)
       ├─ interpreter network check   (not reached)
       └─ path containment            (not reached)
  │
session receives the §5.4 message and follows the needs_operator protocol instead
```

### 16.3 `drive` from `main`, task paused on its branch (the E17 fix, AC3.1)

```
cwd = repo root, HEAD = main, tree clean
  │
discoverTasks(plans/)                     → #5 [need_decision per main], #6 [need_objective per main]
  │                                          ← main's state.yml is stale for #6 (unmerged); #5 is
  │                                            merged, so main carries its real stage
resolveTaskSources(git, …)
  ├─ #5  local branch gone, origin/vibe-racer/0005_… exists, squash-merged into main:
  │       plan folder on HEAD identical to the ref's
  │       → case 1a: branchState "merged", source working-tree   (03_plan_questions.md Q7.5)
  │       → 06_decision.md not ticked → not actionable
  └─ #6  local branch exists, not current
          → case 2: readFileAtBranch("vibe-racer/0006_…", "plans/0006_…/state.yml")
                      → stage: need_operator
                    readFileAtBranch(…, "plans/0006_…/04_execute.md")
                      → readPauseBlockState → markerTicked: true
  │
buildCandidates → [#6 ticked]
selectTask       → #6
ensureBranch     → treeStatus clean → git checkout vibe-racer/0006_…
advanceSelected  → tryAdvance → resumeFromOperatorPause → settleRow → resumeFromOperator
                   → "Resuming G1 at [ready_to_execute]"
dispatch("ready_to_execute") → the execute loop, committing to the task branch (AC3.2)
report → "You are now on vibe-racer/0006_drive-enforcements." + Also actionable
```

### 16.4 Plan review with a named dependency

```
dispatch("ai_plan_review") → handlePlanReview
  │
resolveNamedRefBlock(ctx)
  ├─ read 00_objective.md, 01_product.md, 02_design.md, 03_plan_questions.md (live lines)
  ├─ findNamedRefs → [{pr, 12}, {branch, "vibe-racer/0004_fasten-dead-code"}]
  ├─ resolveRefStatus (≤10 refs, 5 s each, no fetch)
  │     ├─ gh pr view 12 --json state,mergedAt   → "open"
  │     └─ merge-base --is-ancestor               → "not-ancestor-of-main"
  └─ renderRefStatus → the §4.5 block (state only — no titles, no bodies)
  │
handleReviewWithRounds → planReviewPrompt(ctx, round, refBlock) → runAndStream
  │   session writes 03_plan.md + 04_execute.md, OR follow-up questions
  │
warnForbiddenActions(ctx) → findForbiddenActions over both files → warnings, never a failure
  │
updateStage(need_execution) + commit
```

---

## 17. The two Milestone 3 policy decisions, with reasoning — AC3.8

AC3.8 asks for the **reasoning**, not just the choice. Both decisions are the product's (Q4, Q5);
recorded here because this is the document the plan and execute laps read.

### 17.1 A dirty working tree, when the task is on another branch → **refuse, naming the paths**

**The decision.** If the selected task's branch differs from the current branch and
`treeStatus().clean` is false, `drive` prints the §10.3 message with every dirty path in git's own
`XY path` shape, starts no session, and leaves the tree exactly as it found it. If the task's
branch **is** the current branch, `drive` does not look at the tree at all (AC3.4).

**Why not stash-and-restore.** It is invisible custody of the operator's work. If the session
errors, the process is killed, or a conflict blocks the pop, their changes are sitting in a stash
they did not create and will not think to look for. vibe-racer taking silent ownership of
uncommitted human work is a trust violation out of all proportion to the convenience it buys —
and the convenience is two words they already know.

**Why not commit-on-branch.** Worse. It puts unreviewed operator edits onto the task branch under
a vibe-racer commit message, **inside the diff QA is about to review**. QA's whole subject is
`git diff main...HEAD`; polluting it with whatever the operator happened to have open corrupts
the one artefact the lap exists to produce. (`finalizeTask`'s `commitAll` at `done` is not the
same case: there the only dirty files are the plan documents the pipeline itself produced and the
checkbox the operator just ticked.)

**Why refusal is positively good, not merely least-bad.** It is the only option with no surprise
in it. The tree afterwards is identical to the tree before; the error names the exact paths; the
remedy is `commit` or `stash`. And it fails *before* money is spent — the refusal happens in
`ensureBranch`, ahead of any session.

**The transition cost, accepted and named.** For a while, operators who have been working from
`main` will hit this on their first `drive` of a paused task — including the case where the dirty
file *is* the ticked questions file, which is why §8.4's working-tree look exists at all: without
it the outcome would be a silent "nothing to do" instead of a refusal that names the file. It is
rare afterwards, because `drive` now leaves them on the task branch (§17.2 / §10.5).

**Scope limit, restated because it is easy to over-apply.** The check is about *switching*. It
does not fire when the branch is already current, and it does not fire when the branch is being
created at the current HEAD for a first `drive` — creating a label moves no bytes (§10.3).

### 17.2 Two actionable tasks on different branches → **run the first, name the rest, stop**

**The decision.** One checkout, one lap, one exit. `drive` selects a single task (`--task N`, else
the lowest-numbered actionable), runs its lap, and prints the others in an "Also actionable" line
with the command to take the next. The advancement pass runs for the **selected task only**, so a
ticked task that is not selected does not advance this run.

**Why not chain laps across branches.** It multiplies the ways a run can end somewhere the
operator did not expect. A mid-chain failure leaves them on an arbitrary task branch with one lap
done and one not; a dirty tree created by lap 1 blocks lap 2's checkout halfway through; and
`drive`'s output stops being a report on the lap they asked for and becomes a report on several
tasks. `drive` already selects a single task — M3 must not quietly turn it into a batch runner.
That is a different product decision, and it is in `plans/backlog.md`, not here.

**Why not refuse when several are actionable.** It would make the common case — several tasks in
flight, which is the point of a pit wall — an error state. The operator has done nothing wrong.

**Why the "Also actionable" line is load-bearing, not decoration.** It is the difference between a
deliberate one-at-a-time design and an arbitrary one. The operator learns there is more work and
exactly how to reach it, in one line. Without it, "run drive again" is folklore passed between
users. It is also what makes §9.3's honesty work: a lap that is *named* as skipped is not a lap
*silently* skipped.

**The consequence to state in the output, since it is a real behaviour change.** Before M3, every
ticked human-stage task advanced on every `drive`, whatever was selected. After M3, only the
selected task advances. The "Also actionable" line is where the operator sees that, and the
`drive` documentation says it.

---

## 18. Configuration and Environment

### 18.1 No new configuration — and this is a product property, not an oversight

`.vibe-racer.yml` gains **no keys**. Explicitly rejected (`01_product.md` §1.4, §8.1): an
`allow:` list for the deny list, a per-task guard exemption, a magic comment, a `--force` on
`drive`.

> A property with a config flag is a default, not a property. Anyone who needs vibe-racer to push
> does not want vibe-racer.

The architectural consequence, which §3.7, §5.4 and §10.3 all obey: **because there is no
override, every refusal message carries the whole remedy.** Each must name *what* was refused,
*which rule* refused it, and *what to write or do instead*. A message that only says "denied" has
no escape hatch behind it.

Existing keys are untouched: `repo`, `plans_dir`, `context`, `skills`, `max_turns`.

### 18.2 Environment

| Requirement | Status |
|---|---|
| Node 20+, a git repository, an Anthropic API key or `claude login` | Unchanged |
| **The prerequisite task merged into `main`, this branch rebuilt on it** | **New.** Checked at the top of the plan lap (AC0.1), not assumed |
| `gh` on PATH | Still optional. `named-refs.ts` degrades to `unknown`; gate verification degrades to local refs, as the execute prompt's fallback ladder already describes |
| A configured remote | Not required. Nothing here contacts a remote except `gh pr view` (optional) and the read-only verifications §5.2 preserves |
| Network | Not required. One optional, timeout-bounded `gh pr view` per named PR |
| New runtime dependencies | **None.** `node:child_process` is built in |

---

## 19. Edge cases, residuals and what stays broken

`01_product.md` §9.2 and §9.3 enumerate the behavioural edge cases and this design implements
them as written. Three deserve a design-level note because they are architectural, not
behavioural.

### 19.1 A completed task whose branch was deleted

Seen in this repository on 2026-10-10: #5's local branch was gone while its `06_decision.md` tick
sat uncommitted on #6's branch. Case 5 of §8.3 catches it — stage past `need_objective`, no
branch anywhere → `ensureBranch` refuses and says how to recreate it. The failure mode this
prevents is specific and bad: creating `vibe-racer/0005_…` from the current HEAD would cut it
from **another task's work**, and the lap would then run and commit there.

A `done` task is not actionable, so the common version of this never reaches `ensureBranch` at
all. The case that does is a task mid-pipeline whose branch was deleted early.

> **Corrected at the `need_plan` review (2026-10-11).** Case 5 needs *no branch anywhere*. #5 in
> this repository still has `origin/vibe-racer/0005_infinite-loop-fix` and was squash-merged, so
> it is not case 5, and §8.3 as written would read it from the stale remote ref (case 3). The
> rule that covers a merged task whose ref survives, and the first-`drive` refusal from another
> task's branch (§10.3), are in `03_plan_questions.md` Q7.4–Q7.5, which override this document —
including §10.4's decision to leave `finalizeTask`'s own `checkoutBranch` call in place.

### 19.2 An unterminated fence hides a refusal

A stray ``` above a gate row makes `isLive` false for everything below it, so CHECK B finds
nothing and the tick passes. This is the same hazard `resumeFromOperatorPause` already names for
the pause block, and it is handled the same way: the caller names the stray fence rather than
failing silently (§3.6). Worth stating plainly: for the pause block a stray fence *blocks* a
resume (visible, annoying), while here it *permits* a sign-off (invisible, bad). That asymmetry
is why `describeForbiddenActions` takes `strayFence` and why `signOffPlaybook` passes it.

### 19.3 `commitAll`'s `git add .` is unchanged — and that is a recorded residual

`finalizeTask` and every handler commit via `commitAll`, which stages `.`. On a first `drive`
from a dirty tree (§10.3), unrelated operator edits land in the task's first commit. This is
**pre-existing**, it is not what M3 is about, and fixing it means deciding what a handler commit
should stage — a question with its own answers (path-scoped staging, a pre-commit refusal, a
warning). Recorded here and bound for `plans/backlog.md`; not fixed in passing, because
"guardrails only tighten" cuts both ways: a silent change to what gets committed is not a
tightening anyone asked for.

### 19.4 Residual summary table

| Residual | Where it is documented |
|---|---|
| `Verify PR #12 is merged` passes the keyword check | §3.9; `docs/security.md`; mechanism is the §4 dependency question |
| `Verify by merging PR #12` passes | §3.9 |
| `Tag the screenshot …` is refused (false positive) | §3.9; the message supplies the reword |
| `gh api -X PUT …/merge` still writes to the remote | §5.6; Known Limitations in all three security docs |
| `sh -c "git push"`, `eval`, a script file | §5.6; Known Limitations in all three security docs |
| A branch on the remote that was never fetched looks like a first `drive` | §8.3; `docs/how-it-works.md` |
| `commitAll` stages `.` | §19.3; backlog |

---

## 20. Testing Strategy

Framework unchanged: `vitest run`, tests mirroring `src/` under `tests/`. Build, lint, typecheck
and tests pass at **every** milestone (objective constraint); coverage only up.

### 20.1 `tests/pipeline/forbidden-actions.test.ts` — the case table, verbatim

Design Q1's worked-cases table **is** the test, as an `it.each`. Every row, including the ones
that pass:

| Subject | Expected |
|---|---|
| `Merge PR #12` | refused |
| `Confirm the release tag v0.3.0 exists on the remote` | passes |
| `Confirm the build, then merge PR #12` | refused (second clause) |
| `Verify PR #12 is merged and deployed` | refused (`deployed` is its own clause) |
| `` Check that `gh pr merge 12` succeeded `` | refused (command form, never exempt) |
| `Tag the screenshot with the build number` | refused (accepted false positive) |
| `Configure the staging dashboard and screenshot it` | passes (rule 5) |
| `Update the package version in the stage config` | passes (rule 5) |
| `Verify docs/release.md exists` | passes (one clause, verification verb, `/` is a path) |
| `` `git merge-base --is-ancestor origin/x main` exits 0 `` | passes (rule 6, masked) |
| `` Run `git merge-base --is-ancestor origin/x main`, then merge `` | refused (mask inert, trailing verb is not) |
| `Verify PR #12 is merged` | **passes** — the residual, asserted so a future "fix" has to argue with a test |

Plus: every entry in `FORBIDDEN_ACTIONS` refused in at least one phrasing (AC1.4); every
`VERIFICATION_VERB` exempting a clause it begins; fenced and `> `-quoted subjects inert (AC1.5);
`FORBIDDEN_ACTION_SPEC` containing every label (§3.8); `describeForbiddenActions` never
containing the refused subject's own PR number in its hint (§3.7 invariant 3).

### 20.2 Guard tests — denials and allowances with equal weight

In `tests/claude/guard.test.ts`, against **whatever decision function the prerequisite task
leaves in `guard.ts`** — never a transport called by hand (design Q2). One case per command in
both directions, plus the §5.2 command table in full, plus:

- `REMOTE_WRITE_DENYLIST` ∩ `READ_ONLY_COMMANDS` is empty;
- a denial appends to `.vibe-racer/audit.log` (AC2.1) — the existing audit test pattern;
- the message names the command, the rule and the ownership (AC2.3);
- the rule is **inactive** at every stage except `ready_to_execute`, asserted per stage, so the
  scope decision is a test and not a comment.

### 20.3 `tests/cli/drive-branch.test.ts` — a real temporary git repository

`tests/cli/drive.test.ts` mocks `git/operations.js` wholesale, which is right for the dispatch
and message logic and **wrong** for M3: the thing under test is whether `git show` and a checkout
behave as assumed, and a mock that returns what the code expects proves nothing.

So M3 gets a second file that builds a real repo in a temp dir per test — `git init`, a commit on
`main`, a `vibe-racer/0006_…` branch with a plan folder committed on it, and a fake remote-tracking
ref created with `git update-ref refs/remotes/origin/vibe-racer/0006_… <sha>` (no network, no
second repo). It covers AC3.1–AC3.6 end to end, plus every row of §8.3's decision table and
§10.3's. `tests/git/operations.test.ts` already establishes the temp-repo pattern to follow.

The existing mocked `drive.test.ts` stays, updated for the new call order.

### 20.4 Prompt and document tests

- **`tests/claude/prompts-gate-examples.test.ts` (AC1.3).** Render `EXECUTION_TABLE_SPEC`,
  `PAUSE_BLOCK_SPEC`, `planReviewPrompt` and `executeMilestonePrompt` and assert
  `findForbiddenActions` returns `[]` over the gate examples. The generated spec, checked by the
  generated checker — no hand-maintained word list that can fall behind `FORBIDDEN_ACTIONS`.
- **AC1.8.** `qaPrompt(ctx)` takes one argument; no rendered QA prompt contains the coverage
  statement or the "Operator gates this task paused at" heading.
- **`tests/claude/docs-agree.test.ts` (AC2.4).** Read `docs/security.md`, `SECURITY.md` and
  `README.md` and assert: the `BASH_BLOCKLIST` count matches all three; each of the five denied
  commands is named in all three; `gh api` and nested shells appear under Known Limitations; and
  the string "cannot push" appears in none of them. #5 M8 corrected these three documents into
  agreement by hand — a test is what keeps them agreeing.

### 20.5 Sign-off, named-refs and backward compatibility

- `tests/state/advancement.test.ts` gains: AC1.2 (a hand-written `G1 | Merge PR #12 | operator`
  followed by `M1` — refused, row named, box unticked, hint printed); AC1.6 (an agent row with a
  forbidden verb — not refused); AC1.7 (unparsable table → tick honoured, `03_plan.md` scan still
  runs); AC1.9 (a non-merge gate playbook signs off exactly as before); re-ticking refuses
  identically; `03_plan.md` missing → warn and skip.
- `tests/pipeline/named-refs.test.ts`: `findNamedRefs` (fenced, `> `-quoted, bare `#N` ignored,
  branch-name shape); `resolveRefStatus` with `gh` absent / non-zero / hanging past the timeout /
  returning each state; and the injection test — a PR title containing instructions never reaches
  the rendered prompt.
- `tests/pipeline/operator-block.test.ts` gains AC3.7: a block with the **legacy** closing line is
  found, normalised and resumed; a newly rendered block names no branch.

### 20.6 What is not tested, and why

The guard's *transport* — that the SDK consults the hook under `bypassPermissions`. That belongs
to the prerequisite task, which owns the probe and the evidence. A test here that asserted it
would be asserting someone else's milestone, and a green test for a property this task cannot
affect is exactly the "prints PASS without testing anything" failure the guard's own comments
warn about.

---

## 21. Build and Distribution

Unchanged. `tsup` → `dist/`, ESM, Node ≥ 20, `bin: vibe-racer → ./dist/index.js`. Two new modules
in `src/pipeline/`, one in `src/state/`; nothing added to `files` in `package.json`.

**Release shape.** This task ships as one release **after** the prerequisite task's, on a `main`
that already carries it (`01_product.md` §3). It is not a patch of 0.3.0: `main` carries #5's
unreleased work, and the guard fix lands ahead of this. The version number is a decision for the
`done` lap, not a design one. Published `vibe-racer@0.3.0` is affected by the guard defect and
its disclosure travels with the **prerequisite** task, not this one.

A commit per milestone, and the three milestones in the fixed order **1 → 2 → 3** (objective,
*Decisions already made*): the prompt fix stops the next planned task from producing the row; the
guard rule is mechanical and stands on the prerequisite; the checkout carries the design
decisions and the widest test surface.

---

## 22. Dependency Summary

### 22.1 Runtime — no additions (objective constraint)

| Package | Already present | Used by this task for |
|---|---|---|
| `simple-git` | yes | `readFileAtBranch`, `listRemoteTaskRefs`, `treeStatus`, ancestry, checkout |
| `@anthropic-ai/claude-agent-sdk` | yes | `CanUseTool` / `PermissionResult` types in `guard.ts` |
| `yaml`, `zod` | yes | `parseStateContent` (the existing `stateSchema`) |
| `chalk`, `commander`, `@inquirer/prompts` | yes | unchanged CLI surface |
| `node:child_process` | built in | `gh pr view` in `named-refs.ts` |

### 22.2 Internal dependency additions

| From | To | Note |
|---|---|---|
| `claude/guard.ts` | `pipeline/forbidden-actions.ts` | **first `claude/` → `pipeline/` import in `guard.ts`** (design Q2). Safe: the target is a leaf |
| `claude/prompts.ts` | `pipeline/forbidden-actions.ts` | the same pattern `EXECUTION_TABLE_SPEC` and `PAUSE_BLOCK_SPEC` already use |
| `state/advancement.ts` | `pipeline/forbidden-actions.ts` | beside its existing `execute-table` / `operator-block` imports |
| `state/discovery.ts` | `git/operations.ts`, `pipeline/validation.ts`, `pipeline/operator-block.ts` | the per-task resolution and the tick readers |
| `state/actionable.ts` | `state/discovery.ts`, `pipeline/states.ts` | the candidate predicate |
| `cli/drive.ts` | `state/actionable.ts` | replaces the inline advance-everything loop |
| `pipeline/forbidden-actions.ts` | `pipeline/markdown-scan.ts` **only** | the leaf discipline; a type-only import of `Owner` (§3.5) adds no runtime edge |

### 22.3 Modules deliberately left alone

`markdown-scan.ts` (changing it would trigger the four-playbook equivalence check for no gain),
`execute-table.ts`'s parser (only its worked example changes), `states.ts`, `machine.ts`,
`skills.ts`, `session.ts`, `review-runner.ts` (design Q4 *Scope*: the other three review handlers
must not start shelling out), and `repoSnapshot` (§7).

---

## 23. Traceability: acceptance criteria → module

| AC | Where it is implemented | Where it is proven |
|---|---|---|
| AC0.1 | plan-lap verification step (not code) | `03_plan.md`'s opening section |
| AC1.1 | §4 `named-refs.ts` + `planReviewPrompt` refStatus block | `named-refs.test.ts`, plan-lap output |
| AC1.2 | §6 CHECK B + §3.7 `describeForbiddenActions` | `advancement.test.ts` |
| AC1.3 | §11 spec/prompt rewrites | `prompts-gate-examples.test.ts` |
| AC1.4 | §3.4 clause algorithm | `forbidden-actions.test.ts` (the Q1 table) |
| AC1.5 | §3.6 live-lines-only | `forbidden-actions.test.ts` |
| AC1.6 | §6.3 operator rows only | `advancement.test.ts` |
| AC1.7 | §6.1 degradation contract | `advancement.test.ts` |
| AC1.8 | §13.2 `qaPrompt(ctx)` | `prompts.test.ts`, `qa.test.ts` |
| AC1.9 | §6 (non-merge gates untouched) | `advancement.test.ts` |
| AC1.10 | §14.4 + doc edits | `docs-agree.test.ts` (partial), review |
| AC2.1 | §5.1–§5.3 `REMOTE_WRITE_DENYLIST` + `deny()` | `guard.test.ts`, `audit.test.ts` |
| AC2.2 | §5.2 `READ_ONLY_COMMANDS` allowances | `guard.test.ts` |
| AC2.3 | §5.4 message built from `label` | `guard.test.ts` |
| AC2.4 | §5.5–§5.6 + doc edits | `docs-agree.test.ts` |
| AC3.1 | §8.3 case 2 + §10.3 | `drive-branch.test.ts` |
| AC3.2 | §10.1 checkout before dispatch | `drive-branch.test.ts` |
| AC3.3 | §10.3 + §17.1 | `drive-branch.test.ts` |
| AC3.4 | §10.3 `current` row | `drive-branch.test.ts` |
| AC3.5 | §9 + §10.5 + §17.2 | `drive-branch.test.ts`, `actionable.test.ts` |
| AC3.6 | §10.5 `report` | `drive-branch.test.ts` |
| AC3.7 | §10.6 + §12 | `drive.test.ts`, `operator-block.test.ts` |
| AC3.8 | **§17** | this document |

