---
task: 9
title: fenced-decoy
---

<!-- Synthetic, full-file shaped. The QA probe for issue #1, promoted to a fixture: a plan agent
     that quotes the table contract into its own Rules section used to hand the loop a second
     table, ranked FIRST because the parser took the first matching heading in the file with no
     fence tracking. It executed the example's milestones and rewrote the example's status cells.
     Both the decoy's heading and its rows must be inert. -->

# Execution Playbook — #9: fenced-decoy

## Rules

The contract the plan prompt delivers, quoted here the way an agent quotes it:

```markdown
## Execution Status

| Milestone | Name | Owner | Status | Commit | Notes |
|---|---|---|---|---|---|
| M1 | Table contract + parser | `agent` | `done` | `a1b2c3d` | — |
| G1 | Operator merges PRs #12 and #14 | `operator` | `pending` | — | Unblocks M2 |
| M2 | Wire the parser into the loop | `agent` | `pending` | — | — |
```

And the same thing again as a blockquote, which is how a session sometimes echoes it back:

> ## Execution Status
>
> | Milestone | Name | Owner | Status | Commit | Notes |
> |---|---|---|---|---|---|
> | Q1 | Quoted decoy | `operator` | `pending` | — | — |

## Execution Status

| Milestone | Name | Owner | Status | Commit | Notes |
|---|---|---|---|---|---|
| R1 | The real first milestone | `agent` | `done` | `d4e5f6a` | — |
| R2 | The real second milestone | `agent` | `pending` | — | — |
