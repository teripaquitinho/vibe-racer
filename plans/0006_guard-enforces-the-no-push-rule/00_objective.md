# Objective

Make "vibe-racer never pushes" a guard rule, not just a prompt rule.

Today the rule that an execute session never pushes, opens or merges a PR, cuts a release or runs
a workflow lives only in `executeMilestonePrompt` and the `radio` role description. `canUseTool`
in `src/claude/guard.ts` does not block any of it: an agent that ignored the prompt could run
`git push` from a `ready_to_execute` session. Task #5 (infinite-loop-fix) left the guard
deliberately untouched and recorded this as a Known Limitation in the security declaration; this
task closes it.

## Scope

Add a `ready_to_execute` deny list to the Bash guard for, at minimum:

- `git push`
- `gh pr create`
- `gh pr merge`
- `gh release`
- `gh workflow run`

The denial goes through the same `canUseTool` path as the existing `BASH_BLOCKLIST`, is written to
the audit log like every other denial, and is documented in `docs/security.md`, `SECURITY.md` and
the README "Security" section, which currently list the prompt-only rule under Known Limitations.

## Hard requirement — the read-only allowances

**`git fetch`, `gh pr view` and `gh pr list` must stay allowed.** Gate verification (the first
step of any milestone that follows an operator gate) runs exactly these commands to confirm a
gate cleared — `git fetch` before `git merge-base --is-ancestor`, `gh pr view` to check a merge.
A deny list that catches them breaks every plan with an operator gate: the agent could never
verify, would fall back to the operator's tick every time, and the fallback ladder in the execute
prompt would become the only path. Tests must cover the allowances as explicitly as the denials.

## Out of scope

- Changing what the prompts say — they already state the rule; this task enforces it.
- `radio`, which spawns the operator's own interactive `claude` CLI where `canUseTool` does not
  run. Its guardrail stays prompt-only and the security declaration keeps saying so.
- Any other stage's Bash rules.

# Complete

- [ ] Ready to advance to Objective Review
