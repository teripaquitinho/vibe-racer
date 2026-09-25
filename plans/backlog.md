# Plans backlog

Small, concrete leftovers from a task's QA lap or decision checklist that did not earn a plan
folder of their own. Each entry names its source, its size and the trigger that would promote it
to a task. Product and roadmap items live in the root `backlog.md`, not here.

---

## Deferred fixes

### F10 — keep the session's final message on the pause reuse path

| | |
|---|---|
| **Source** | #5 `05_qa.md` issue 4 · `05_qa_plan.md` §3.11 · `06_decision.md` "F10 / I4" |
| **Effort / risk** | M / Low |
| **Where** | `src/pipeline/handlers/execute.ts` `pause()`, reuse branch; `src/pipeline/operator-block.ts` |

**What is lost.** When the agent sets a row to `needs_operator` and authors its own
`## Operator actions` block, `pause()` reuses that block instead of rendering one, and
`input.agentMessage` — the session's final message — is never written. The block keeps the agent's
`**Why paused:**` line, which is the substantive part; what disappears is the closing narration,
usually a restatement.

**Fix shape.** A writer in `operator-block.ts` that inserts or replaces the quoted
`**What the agent said:**` section inside an existing block (fenced and `> `-prefixed, exactly as
`renderPauseBlock` does it), called from the reuse branch, plus normalisation tests proving the
inserted message is inert. About a session's work.

**Trigger.** A real pause where the agent's block was thinner than its final message. Until then
the objective's "nothing the agent explained is thrown away" is met substantively, not literally,
and that is recorded as an accepted risk in #5's decision checklist.

### `depends_on` — a task that waits for another task's merge

| | |
|---|---|
| **Source** | #6 `00_objective.md` "Out of scope"; the mid-execution merge-gate incident of 2026-09-24 |
| **Effort / risk** | M / Low |
| **Where** | `src/cli/new.ts`, `src/state/schema.ts`, `src/cli/drive.ts`, `src/cli/pitwall.ts` |

**What.** A dependency on another task's work is a sequencing decision, not a gate (#6, milestone
1). Today that decision lives in the operator's head. `new --after 0004` would record
`depends_on: [4]` in `state.yml`; `drive` would refuse to start the execute lap (or to leave
`need_objective`) until `git merge-base --is-ancestor vibe-racer/0004_… main` holds, naming the
dependency; `pitwall` would show "waits for #4". The merge stays the operator's and happens after
#4's `done`, which is exactly when it should.

**Trigger.** A second task that has to wait for another one, once #6 has removed the gate-row
way of expressing it.

---

## Process notes

### Scratch probes stay outside the repository

| | |
|---|---|
| **Source** | #13 QA lap |

The QA lap for #13 ran probe tests inside `vibe-racer/0013_add-search-segment/` and deleted them
afterwards. The tree was clean and `git status` was empty, so nothing leaked — but a probe that is
forgotten becomes a commit. Probes go in the session scratchpad, never inside the repo. #5's QA
plan (§6) and its batch B QA report follow this.
