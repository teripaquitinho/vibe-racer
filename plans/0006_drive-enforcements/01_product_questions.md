# Product Questions for #6: drive-enforcements

> **Role**: Senior Product Designer
> **Stage**: `ai_objective_review` → `need_product`
> **Date**: 2026-09-28

---

## The merge ban — what it catches and what the operator feels

### Q1: How wide is the forbidden-verb list, and which false positives do we accept?

The objective commits to a keyword check on gate rows and `## G<n>` sections, and asks whether
"close a PR" and "tag" are false positives worth tolerating. The real product question is which
*legitimate* operator gates get caught. A gate that says "confirm the release tag `v0.3.0` exists
on the remote" is a read-only precondition, not a release step, but any list containing "tag"
refuses it. Same for "check the PR was closed without merging" and for a milestone named "deploy
config to the staging dashboard and screenshot it", which is exactly the kind of eyes-on gate
milestone 1 wants gates to be.

So: is the list optimised for zero escapes (broad, refuses read-only phrasings too) or for zero
friction on legitimate gates (narrow, only the imperative forms)?

**Answer:**
Optimise for zero escapes with a broad list, and make the reword cheap by saying exactly what to
write instead.

The list is: `merge`, `push`, `open a PR` / `open PR` / `create a PR`, `close a PR`, `tag`,
`release`, `deploy`, `publish`, plus the `gh` / `git` command forms (`git push`, `gh pr create`,
`gh pr merge`, `gh release`, `gh workflow run`). All of them refuse, including read-only
phrasings — a gate that wants to *verify* a tag or a closed PR must say so with a verification
verb (`confirm`, `check`, `verify`, `inspect`) and that phrasing is what the prompt teaches. The
refusal message therefore always carries a rewrite hint, not just a complaint:

> `G1 | Merge PR #12 | operator` asks for a merge. A task's cycle ends at `done`; the merge is
> yours to do afterwards. If this task *needs* #12's work, that is a dependency — sequence this
> task after it, or base this branch on it — and it belongs in `03_plan_questions.md`, not in the
> playbook. If you only need to *check* #12's state, reword the row to "Confirm PR #12 is merged".

Rationale: the cost of a false positive is one reword by whoever wrote the row, and the message
tells them the reword. The cost of an escape is a paid execute lap that sends the operator to
`main` to merge unreviewed work — the exact failure that already happened on a host project. That
asymmetry is not close.

### Q2: When a guardrail bites, is there an override?

Two new guardrails can block a human who is certain they are right: the sign-off refusal (which
unticks the box) and the new Bash deny list (which refuses `git push` mid-session). Does the
operator get an escape hatch — a `--force` on `drive`, an `allow:` key in `.vibe-racer.yml`, a
magic comment in the playbook — or is rewording the row the only road?

**Answer:**
No override, on either guardrail. Rewording is the only road, and that is the feature.

- **Sign-off refusal.** The operator's escape hatch is the text itself: edit the row, or delete
  the gate and take the step by hand outside the pipeline. That is one line of editing and it
  leaves a truthful playbook behind. A `--force` would leave a playbook that says "merge PR #12"
  and a pipeline that executed it — the artefact would lie about what happened, which is worse
  than the friction.
- **Guard deny list.** No config key, no per-task allowance. The README and `docs/security.md`
  will state "vibe-racer cannot push" as a property, and a property with a config flag is a
  default, not a property. Anyone who needs vibe-racer to push does not want vibe-racer.

The operator's actual escape hatch for both already exists and stays: they do the thing
themselves, on their own terminal, with their own credentials. The constraint is on the agent, not
on them. Consequence to honour in the design lap: because there is no override, the refusal and
denial messages carry the whole burden of being actionable — see Q1's rewrite hint, and the
denial message must name the command, the rule, and that the operator does this step themselves.

### Q3: How hard does plan review look for dependencies — the plan text, or the repo?

Milestone 1 makes `ai_plan_review` raise a question when the plan depends on unmerged work. It can
do that from the plan text alone (the plan says "needs the refactor from #4"), or it can probe the
host repo — `git branch --contains`, `gh pr list`, comparing `vibe-racer/*` branches against
`main` — and surface dependencies the plan never mentioned.

**Answer:**
Plan text only, for this task. Repo probing is out of scope and goes to `plans/backlog.md` beside
the `depends_on` precondition it belongs with.

Reasoning, in product terms: a repo probe answers a question nobody asked. `gh pr list` returning
three open PRs tells the plan lap nothing about whether *this* task depends on them, so it either
stays silent (no value) or asks about all three (three questions the operator must dismiss at every
`need_plan`, on every task, forever). Noise at a pit stop is expensive — pit stops are where the
operator's attention is spent, and a question they learn to skim is a question that stops working.

The plan text, by contrast, is a document the agent just wrote and fully understands. If it wrote
"this needs #4's new `scanLines` signature", it knows there is a dependency and can ask one precise
question with the two legitimate answers (sequence after #4, or base this branch on #4's). One
dependency, one question, at the moment the operator can act on it.

One narrow exception, because it is free and specific: if the plan text names a branch or PR by
identifier (`vibe-racer/0004_…`, `#12`), plan review may run the read-only checks the guard already
allows (`gh pr view`, `git merge-base`) to state that dependency's *current* status in the
question — "PR #12 is still open" — so the operator decides with a fact rather than a memory. It
never goes looking for dependencies the plan did not name.

## `drive` on the task branch — the operator's terminal

### Q4: What does `drive` do with a dirty working tree?

Milestone 3 makes `drive` check out the task branch before the advancement pass. The operator may
have uncommitted work when they run it. Refuse, stash-and-restore, or commit-on-branch as
`commitAll` already does at `done`?

**Answer:**
Refuse, naming the dirty paths, and do nothing else. The objective's proposal is right.

```
Task #6 needs branch vibe-racer/0006_drive-enforcements, but you have uncommitted changes:
  M  src/claude/guard.ts
  ?? notes.md
Commit or stash them, then run `vibe-racer drive` again.
```

Why not the other two:

- **Stash-and-restore** is invisible custody of the operator's work. If the session errors, the
  process is killed, or a conflict blocks the pop, their changes are in a stash they did not create
  and will not think to look for. vibe-racer taking silent ownership of uncommitted human work is a
  trust violation out of all proportion to the convenience it buys.
- **Commit-on-branch** is worse: it puts unreviewed operator edits onto the task branch under a
  vibe-racer commit message, inside the diff QA is about to review. The `done` case is different
  and stays as it is — there the only dirty files are the plan documents the pipeline itself
  produced and the checkbox the operator just ticked.

Refusal is also the only option that is free of surprise: the operator's tree is exactly as they
left it, and the fix is two words they already know.

Scope note the design lap must respect: the check is about *switching branches*. If the operator is
already on the task branch, a dirty tree is not vibe-racer's business — `drive` proceeds. Refusing
there would break the common loop of editing a plan file and driving.

### Q5: Two actionable tasks on different branches, one `drive` — what happens?

**Answer:**
Run only the first actionable task, then name the rest and stop.

```
Drove task #6. Also actionable: #7 (ready_to_execute), #9 (ai_qa).
Run `vibe-racer drive` again to take the next one, or `drive --task 7` to pick.
```

One checkout, one lap, one exit — chaining laps across branches multiplies the ways a run can end
somewhere the operator did not expect: a mid-chain failure leaves them on an arbitrary task branch
with one lap done and one not, and the `drive` output becomes a report on several tasks instead of
on the lap they asked for. `drive` already selects a single task today; milestone 3 should not
quietly turn it into a batch runner. That is a different product decision and it is not this task's.

The explicit "also actionable" list is the part that makes this feel deliberate rather than
arbitrary — the operator learns there is more work and how to reach it, in one line. Without it,
"run drive again" is folklore.

### Q6: Where is the operator left afterwards, and what happens to the branch signposting?

After a lap, `drive` can restore the branch the operator was on, or leave them on the task branch.
And the two E17 workarounds — the branch hint when there is nothing to do, and the pause block's
"When done, switch back to branch `…`" closing line — need a verdict now that the checkout is the
pipeline's job.

**Answer:**
Leave the operator on the task branch. Do not restore.

The lap just wrote plan documents and possibly code onto that branch, and the operator's next
action is always to read them — review a spec, tick a checkbox, inspect a diff. Restoring `main`
would bounce them away from the files `drive` just told them to open, and every `drive` run would
end with them typing the checkout by hand. State this in the closing output so it is a promise and
not a side effect:

```
You are now on vibe-racer/0006_drive-enforcements.
Next: review plans/0006_drive-enforcements/01_product_questions.md and tick the checkbox.
```

The signposting, then:

- **`branchHint` in `drive` — delete it.** Its entire job was explaining why a paused task looked
  idle from `main`. After milestone 3 it cannot happen, and a hint that describes an impossible
  situation teaches the operator something false about how the tool works.
- **The pause block's closing line — keep it, reworded, without the branch.** "When done, tick
  every box above and run `vibe-racer drive`." The branch name in that line was a workaround; the
  instruction it wrapped is the one thing the operator must know at a pause, and it must survive.
  Dropping the branch also removes a stale-name hazard, since the block persists in the file.
- **Keep the branch name where it is still a fact rather than an instruction** — the `done`
  message's "Merge `vibe-racer/…` when ready", and the new closing line above. The operator needs
  the name to merge; they no longer need it to drive.

# Complete

- [ ] Ready to advance to Product Review
