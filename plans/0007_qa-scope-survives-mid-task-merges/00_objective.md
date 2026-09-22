# Objective

Make the QA lap review the whole task even when part of it was merged into `main` at an operator
gate.

The QA lap (`ai_qa`) is scoped to `git diff main...HEAD`. That is the right scope for a task that
runs start to finish on its own branch. It stops being right the moment an operator gate is
involved: once work done before the gate is merged into `main` — other PRs the milestone depended
on, or an earlier slice of this same task — and the branch is updated from `main`, that work leaves
the diff. QA then reviews a fraction of the task and reports on it as if it were the whole.

Task #5 (infinite-loop-fix) made this **visible** rather than fixing it: `qaPrompt` is told every
operator gate the playbook carries, and the report has to open with a coverage statement naming
each one ("This task paused at G1 (PRs merged into main). Work merged before that gate is outside
`git diff main...HEAD` and was not reviewed here."). `docs/how-it-works.md` lists it as a known
limitation of operator gates. This task removes the limitation.

## Questions this task has to answer

- What is the right review scope for a task that paused at a gate — the diff against the
  merge-base recorded when the task branch was created, the union of per-milestone commits, the
  commits listed in the Execution Status table's `Commit` column, or something else?
- Where does the pipeline record what it needs to reconstruct that scope, given that `state.yml`
  is pipeline-owned and the playbook is agent-editable?
- What happens when the operator squash-merged at the gate, so the pre-gate commits no longer
  exist on `main` in their original form?
- Does the coverage statement stay (as a statement of what *was* reviewed) or go?

## Out of scope

- Changing when QA runs. It stays after the last agent milestone and before cleanup.
- Anything about how gates pause or resume — that shipped in #5.

# Complete

- [ ] Ready to advance to Objective Review
