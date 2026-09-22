# Objective

Make `vibe-racer drive` operate on the task's branch regardless of the branch the operator happens
to be on.

`drive` reads every plan file from the working tree as it is at the moment it runs. If the
operator is on `main` — likely after an operator gate, because the work at a gate is usually
merging on `main` — the task's `04_execute.md` and `state.yml` are the versions on `main`, not on
`vibe-racer/NNNN_slug`. From `main` a paused task does not look paused, a ticked resume marker is
not seen, and a `drive` that does start a session would commit to the wrong branch. Task #5
(infinite-loop-fix) worked around this by naming the task branch in every pause block's closing
line and on the pit board ("switch back to `vibe-racer/…`, tick every box above and run
`vibe-racer drive`"), and by having `drive` print a branch hint when there is nothing to do. This
task makes the checkout the pipeline's job.

## Scope

- `drive` checks out the task's branch **before** the advancement pass, so the files it reads and
  the tick it looks for are the ones on that branch.
- Decide what happens with a **dirty working tree**: refuse and say what is dirty, stash and
  restore, or commit-on-branch as `commitAll` already does for a task at `done`. The decision is
  written down with its reasoning.
- Decide what happens with **two actionable tasks on different branches** in one `drive`: run
  them one after another with a checkout between, run only the first and name the second, or
  refuse. The decision is written down with its reasoning.
- Restore the operator's original branch afterwards, or say clearly that `drive` leaves them on
  the task branch and why.

## Out of scope

- Pushing, pulling, rebasing or merging any branch — `drive` still never touches the remote.
- Creating the branch: that already happens on the first `drive` for a task.

# Complete

- [ ] Ready to advance to Objective Review
