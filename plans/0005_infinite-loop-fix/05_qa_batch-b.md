# QA Report — #5 batch B: one markdown reader (F1, F4b, F7)

> **Role**: Senior QA Engineer
> **Date**: 2026-09-23
> **Scope**: commit `2d59fc5` ("QA fix batch B for #5"), judged against `05_qa_plan.md` §3.8
> (F1), §3.9 (F4b), §3.10 (F7) and §6, and against the objective's constraints "backward
> compatible with in-flight tasks" and "guardrails do not move".
> **Why this file exists**: `05_qa_plan.md` sequenced these three fixes as their own task #9
> because F1 changes the contract of the file every playbook is read through. They were then
> implemented on this branch at the operator's instruction and shipped without a QA lap. This is
> that lap, run before merge. `06_decision.md` "Batch B was never QA'd" points here.
> **Verdict in one line**: batch B does what the fix plan asked and nothing it forbids — the two
> readers of `04_execute.md` now agree, the prompts' worked examples are inert even when pasted
> into a playbook, and the secret-scan catch is a reporting path with the scan untouched. Three
> low findings, all wording or edge-of-CommonMark; one strict-direction regression (a valid file
> that now errors) on a shape no real playbook has.
> **Update, same day**: all three findings were fixed on the branch before merge — see the
> **Status** lines in §2 and the second run in §6. Nothing in §2 is open.

Scope command:

```
$ git show --stat --format='%h %s' 2d59fc5 | tail -12
 CHANGELOG.md                               |  4 +-
 docs/how-it-works.md                       | 11 +++++
 plans/0005_infinite-loop-fix/05_qa_plan.md | 32 ++++++++++---
 src/pipeline/execute-table.ts              | 72 ++++++++++++++++++++----------
 src/pipeline/handlers/execute.ts           | 33 +++++++++++---
 src/pipeline/markdown-scan.ts              | 67 +++++++++++++++++++++++++++
 src/pipeline/operator-block.ts             | 47 +------------------
 tests/fixtures/playbooks/fenced-decoy.md   | 41 +++++++++++++++++
 tests/pipeline/execute-table.test.ts       | 68 +++++++++++++++++++++++++++-
 tests/pipeline/handlers/execute.test.ts    | 60 ++++++++++++++++++++++---
 tests/pipeline/markdown-scan.test.ts       | 52 +++++++++++++++++++++
```

---

## 1. What works

### F1 — one fence-aware scanner (`src/pipeline/markdown-scan.ts`)

| Fix-plan requirement (§3.8) | Evidence |
|---|---|
| `scanLines` / `isHeading` extracted from `operator-block.ts` **unchanged in behaviour**; its tests stay green untouched | The diff removes the two functions and the `ScannedLine` interface from `operator-block.ts` and adds them to `markdown-scan.ts` with the same body (`FENCE_RE`, run-length matching, `trimmed === match[1]` close rule, `quoted: /^\s*>/`). `tests/pipeline/operator-block.test.ts` is not in the commit and passes |
| `markdown-scan.ts` is a leaf module | `import` count in the file: 0. `execute-table.ts` imports it and is itself interpolated into `prompts.ts` without a cycle (typecheck and lint green) |
| `parseExecutionStatus` selects the heading, the section end and the table rows from the scanned view | Heading search: `isHeading(line)`; section end: first later `isHeading`; rows: `collectTableBlocks` takes `scanned` and uses `isLive(scanned[i]) && isTableLine(lines[i])` for header, alignment and data rows |
| A `|` row inside a fence is not a row | Test "ignores a fenced table under the real heading" (`execute-table.test.ts`); probe P7 below |
| A `>`-quoted table is inert | Fixture `fenced-decoy.md` carries a quoted decoy `Q1`; test asserts rows `R1, R2` |
| Fenced-only heading gives a new error naming the line | Test "says the heading is fenced rather than claiming there is none" asserts the wording and `error.line === 4` |
| `setMilestoneStatus` writes into the real row with a decoy present, example byte-identical | Test "writes the status cell into the real row, not the quoted example" |
| Before/after fixture equivalence on `0002`, `0003`, `0004` and this task's playbook (§6) | Re-run here, see §6: `parseExecutionStatus` at `1951a09` and at HEAD return identical `rows`, `headerLineIndex` and `columns` for all four |

Adversarial probes (scratchpad, `npx tsx`, nothing committed), all as intended:

```
P3  fence inside a list item, closed           => real table parses ["M1"]
P4  closing fence carrying trailing text       => does not close (CommonMark), fenced-heading error line 4
P5  ~~~ opened, ``` does not close it          => fenced-heading error line 4
P7a EXECUTION_TABLE_SPEC + PAUSE_BLOCK_SPEC pasted verbatim above a real table and a real pause block
                                               => rows ["M1:pending"] (real), last pause block = the real one (rowId M1), nextPauseNumber 2
P7d setMilestoneStatus on that file            => real row rewritten, pasted spec byte-identical
P9  rendered pause block whose agent message contains a bare ``` fence, a ~~~~ run, a ticked
    resume marker and a full "## Execution Status" table
                                               => markerTicked false, rows ["M1"] only, file ends outside any fence
```

### F4b — the worked examples are fenced

| Requirement (§3.9) | Evidence |
|---|---|
| `EXECUTION_TABLE_SPEC`'s example fenced | Test "still shows the example rows, and shows them fenced" asserts the `| G1 |` line is `fenced` when the spec is scanned. Probe P8: both specs end with the fence closed |
| Meaningless before F1, ships with it | Same commit |
| The rendered prompts are inert to the loop | Probe P6: `parseExecutionStatus` throws "no heading" on both `planReviewPrompt` and `executeMilestonePrompt` output; `findLastPauseBlock(executePrompt)` is `null`; zero live headings containing "Execution Status" and zero live `| G1 |` / `| M8 |` rows across both prompts |

### F7 — a secret in the pause prose does not strand the task

| Requirement (§3.10) | Evidence |
|---|---|
| Catch `SecretDetectedError` around the pause `commitAll` **only** | `execute.ts` has one `try` around the pause commit; `if (!(err instanceof SecretDetectedError)) throw err;`. The milestone commit and the completion commit are outside it |
| The scan itself is not weakened; the rethrow elsewhere stays | `git diff main...HEAD -- src/git/secrets.ts src/claude/guard.ts src/claude/session.ts` is empty. `safe-wrapper.ts:24` and `drive.ts:38` still rethrow; `tests/pipeline/safe-wrapper.test.ts` and `tests/cli/drive.test.ts:248-251` still assert it |
| State stays `need_operator`, recovery printed, no bare stack trace | Test "keeps the pause standing when the secret scan blocks its commit, and says how to recover": `pauseForOperator` called, block written with the marker, warnings contain "written but NOT committed", the playbook path and "Redact it" |
| Any other failure propagates | Test "does not swallow any other failure of the pause commit" (`disk full` rejects) |
| The commit message and log wording say this is a reporting path, not a bypass | Commit body: "The scan is untouched and nothing is committed". Code comment: "The ONE place a `SecretDetectedError` is caught rather than raised". Log: "Nothing was committed and nothing was redacted for you" |
| One catch site in `src/` | `grep -rn SecretDetectedError src/` shows the class, the throw, two rethrows and this one catch |

### Docs and changelog

`CHANGELOG.md` gains a "One markdown reader" entry under Changed, rewrites the F4a bullet to say
"fenced as well as", and adds the F7 line under Fixed. `docs/how-it-works.md` gains the
"Fenced and quoted text is not the document" paragraph with both consequences (fenced-only heading
names the line; an unterminated fence swallows the rest and `drive` names it). `CLAUDE.md`'s
"One markdown reader" bullet landed in the cleanup commit and says the same.

---

## 2. What doesn't

### B1 — the fenced-heading error promises a blockquote case it cannot produce (low)

`parseExecutionStatus` runs `HEADING_RE` on `line.raw` before asking `isHeading`. A heading
quoted as `> ## Execution Status` starts with `>`, so `HEADING_RE` never matches it,
`shadowedIndex` stays `-1`, and the operator gets the old message:

```
P1  file whose only heading is "> ## Execution Status"
    => No "Execution Status" heading found in 04_execute.md. An execution playbook requires ...
```

The new wording — "inside a code fence **or a blockquote** (line N)" — is reachable only for the
fence case. Not a regression (the pre-F1 parser said the same thing), but the message claims a
coverage it does not have, and the QA plan's reason for the new wording ("the operator goes
looking for a heading that is right there on screen") applies to the quoted case too.

**Fix (XS).** When `line.quoted`, test `HEADING_RE` against `raw.replace(/^\s*>\s?/, "")` for the
`shadowedIndex` bookkeeping only, or drop "or a blockquote" from the message. One test: a
quoted-only heading names its line.

**Status: fixed on the branch, same day.** `parseExecutionStatus` strips `> ` prefixes for the
bookkeeping only, so a quoted-only heading now reads "is at line N, inside a blockquote". Test
"names the line of a heading that exists only inside a blockquote". Probe P1 re-run: names line 1.

### B2 — an indented code block that begins with ``` opens a fence (low, strict direction)

`scanLines` trims the line before matching `FENCE_RE`. CommonMark allows a fence up to three
spaces of indentation; four or more is an **indented code block**, and a ``` inside one is
literal text. The scanner treats it as a fence opener, and since the "closing" ``` inside the
same code block is also indented, the fence runs to end of file:

```
P2  "intro" / "    ```" / "code" / <real heading + table>
    old parser (1951a09) => ["M1"]
    new parser           => The only "Execution Status" heading ... is inside a code fence or a
                            blockquote (line 4) ...
```

This is the strict-direction regression §3.8 anticipated ("a valid playbook stops parsing → 
`stage: error`, not a silent skip"). None of the four real playbooks has the shape, and the
error names a line. Two things make it worth a fix rather than an acceptance: the line it names
is the heading's (4), not the stray opener's (2), so the operator hunts in the wrong place; and
the scanner is shared, so the pause-block reader has the same blind spot — an agent that indents
a code sample by four spaces in its own block hides every block after it.

**Fix (XS, but touches both readers).** Match on `/^ {0,3}(`{3,}|~{3,})/` against `raw` instead
of on `trimmed`, and re-run the four-playbook equivalence check afterwards, since it is the only
evidence that a scanner change did not move an in-flight table. Add P2 as a test.

**Status: fixed on the branch, same day.** `FENCE_RE` is now `/^ {0,3}(`{3,}|~{3,})/` matched
against the raw line, for the opener and the closer alike, so four or more spaces (or a tab) is
literal text. `ScannedLine` gained `fenceStart`, and the fenced-heading error now reads "is at
line 4, inside a code fence opened at line 3" — the delimiter the operator has to fix. Tests: three
in `markdown-scan.test.ts` (three spaces opens, four never; an indented closer does not close;
`fenceStart` recorded on every fenced line) and "reads the real table below an indented code block
that begins with ```" in `execute-table.test.ts`. Both readers changed, so the four-playbook
equivalence check was re-run: identical again (§6). `CLAUDE.md` now says to re-run it on every
scanner change.

### B3 — the security declaration does not describe the state a blocked pause commit leaves (low, docs)

Two sentences in `docs/security.md` are off after F7:

- "Operator gates and `need_operator`" → "The block is staged **by the milestone commit** like
  any other file". It is staged by the pause's own commit (`vibe-racer: paused for operator at
  …`), which is the commit F7 is about.
- "Pre-Commit Secret Scanning" ends at "flagged files are unstaged and the commit is blocked".
  For a pause that now means: the task **stays at `need_operator`**, `04_execute.md` is written
  but uncommitted, and the operator redacts and commits by hand. The QA plan put F7 in batch B
  precisely so this section could be re-read alongside it (§3.10 "Why Med risk"); it was not.

**Fix (XS).** One sentence in each place. `SECURITY.md` line 26 ("including the operator pause
block … flagged files are unstaged and the commit is blocked") is accurate as far as it goes and
can take the same clause.

**Status: fixed on the branch, same day.** `docs/security.md` now says the block is committed by
the pause's own commit, and "Pre-Commit Secret Scanning" gained a paragraph on what a blocked
commit does: propagates and stops `drive` for every other commit; leaves the task paused with the
block uncommitted for the pause commit, with the recovery spelled out. `SECURITY.md` carries the
same clause in one sentence. `CHANGELOG.md`'s "One markdown reader" entry describes B1 and B2.

---

## 3. What regressed

Only B2, and only in the direction the fix plan called safe: a file that parsed before F1 now
goes to `error` with a message naming a line. No file that errored before now parses, and no
file parses to a different table — the equivalence check in §6 is the evidence for the four real
playbooks, and the `fenced-decoy` fixture is the one deliberate change (`M1, G1, M2` before,
`R1, R2` after, which was the bug).

Coverage went from 33 files / 648 tests (batch A) to 34 / 662. No test was deleted.

---

## 4. Deviations from the fix plan

| Fix | Plan said | Shipped | Sound? |
|---|---|---|---|
| F1 | Extract `scanLines` / `isHeading` unchanged | Also exports `FENCE_RE` (used by `liftAgentMessage`) and adds `isLive` | Yes — `isLive` is the row rule, `FENCE_RE` was already there |
| F4b | Fence the example **and restore its `##` heading** "so the contract shows the real shape again" | Fenced, still headingless; the spec text says "shown without its heading, because it is a picture of a table" | Yes as defence in depth — a fenced-and-headed example holds only until an agent drops the fence markers (commit message says so). Cost: the contract never shows the heading line the parser keys on; the prose names it instead |
| F7 | Print "which file, **which line**" | Prints `err.message` (file + reason) — `SecretMatch` has no line number and `secrets.ts` is untouched by design | Acceptable; a line would need a scan change, which is out of scope |
| F7 | "a test asserting the error is *not* swallowed elsewhere" | The pre-existing `safe-wrapper` and `drive` rethrow tests, plus a new "any other failure propagates" test on the pause commit | Mostly. There is no test that a `SecretDetectedError` from a **milestone** commit still escapes `handleExecute`; the catch is structurally scoped to the pause commit, so this is a one-`it` regression guard, not a gap in behaviour |
| §6 | Fixture equivalence check "on `main` and on the branch" | Run and recorded in the commit message and re-run here; not committed as a test | Acceptable — the check compares two parser versions, which a unit test cannot hold |

One observation, no change asked: after F7's catch, `commitAll` has already run `git add .` and
unstaged only the flagged file. `state.yml` and anything else the session touched stay **staged**
while `04_execute.md` is modified and unstaged. The log says "nothing was committed", which is
true; it does not claim a clean tree, and the operator's "commit by hand" sweeps it up. Recorded
so nobody reads a partially staged tree as a second bug.

---

## 5. Risks and known limitations

- **The scanner is shared, so a scanner bug is two bugs** (B2 is the example). That is the
  design's point — one rule, both readers — and it is also why any change to
  `markdown-scan.ts` should re-run the four-playbook equivalence check as a matter of course.
  Worth a line in `CLAUDE.md`'s "One markdown reader" bullet.
- **Two pre-existing parser limits, not batch B's, met while probing.** (P10b) a cell before
  `Status` with an odd number of backticks shifts the columns and the row errors with
  `Unknown milestone status ""`; (P11) a heading indented by one to three spaces, legal in
  CommonMark, is not a heading to `HEADING_RE` (column 0). Both are identical at `1951a09`.
  Both stop rather than skip. Out of scope here; recorded so the next parser change knows.
- **B3 is the only place the guardrail story is stale.** Code, tests and `CHANGELOG.md` agree
  on what F7 does; the security document is one revision behind.

---

## 6. Verification run

From a clean tree on `vibe-racer/0005_infinite-loop-fix` at `e7104a5` (batch B at `2d59fc5`
plus the cleanup commit, no `src/` changes after `2d59fc5`), 2026-09-23.

```
$ npm run build && npm run typecheck && npm run lint && npm run test
ESM dist/index.js 142.04 KB
ESM ⚡️ Build success in 13ms
> tsc --noEmit
> eslint src/
 Test Files  34 passed (34)
      Tests  662 passed (662)

$ npx vitest run tests/pipeline/states.test.ts tests/pipeline/markdown-scan.test.ts
 Test Files  2 passed (2)
      Tests  34 passed (34)

$ git diff main...HEAD --stat -- src/claude/guard.ts src/claude/session.ts src/git/secrets.ts
(empty)

$ grep -rn SecretDetectedError src/ | grep -v 'src/git/'
src/pipeline/handlers/safe-wrapper.ts:24:  if (e instanceof SecretDetectedError) throw e;   // never bury this
src/pipeline/handlers/execute.ts:412:      if (!(err instanceof SecretDetectedError)) throw err;
src/cli/drive.ts:38:                    if (e instanceof SecretDetectedError) throw e;
```

Fixture equivalence (scratchpad script importing `execute-table.ts` from `git show 1951a09` and
from HEAD, comparing `JSON.stringify({headerLineIndex, columns, rows})`):

```
0002_add-a-consolidate-function IDENTICAL rows=M1:done,M2:done,M3:done
0003_fasten-2026-04-16          IDENTICAL rows=M1:done,M2:done
0004_add-qa-step                IDENTICAL rows=M1:done,M2:done,M3:done,M4:done,M5a:done,M5b:done,M6:done
0005_infinite-loop-fix          IDENTICAL rows=M1:done,...,M8:done
```

After the B1–B3 fixes, same tree:

```
$ npm run build && npm run typecheck && npm run lint && npm run test
 Test Files  34 passed (34)
      Tests  667 passed (667)
$ (equivalence check, 1951a09 vs HEAD)
0002 IDENTICAL · 0003 IDENTICAL · 0004 IDENTICAL · 0005 IDENTICAL
$ (probes)
P1 => The only "Execution Status" heading in 04_execute.md is at line 1, inside a blockquote, ...
P2 => ["M1"]
P7a/P7b/P9a/P9b unchanged
```

Probes P1–P11 were run from the session scratchpad with `npx tsx`; nothing was written inside the
repository. Their outputs are quoted in §1 and §2.

This file carries no advancement marker on purpose, for the same reason `05_qa_plan.md` does not:
`fine_tuning` reads its marker from `05_qa.md`, and a second one in the plan directory is the
ambiguity this task removed.
