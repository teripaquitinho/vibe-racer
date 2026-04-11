# The Five Laps

vibe-racer races every task through 5 laps, producing 5 documents:

```
00_objective.md -> 01_product.md -> 02_design.md -> 03_plan.md -> 04_execute.md
```

Each lap has a pit stop (human review) and a race engineer phase (AI analyze/generate).

---

## Lap 1: Objective

### Pit stop: Write the objective (`need_objective`)

Write a high-level description of what you want to build in `00_objective.md`. This is the seed -- what needs to be built and why.

Tick the checkbox: `- [x] Ready to advance to Objective Review`

### Race engineer: Review the objective (`ai_objective_review`)

The race engineer reads the objective as a **Senior Product Designer** and generates detailed product-scoping questions in `01_product_questions.md`. Each question includes a pre-filled recommended answer.

**Output:** Product questions file with pre-filled answers.

---

## Lap 2: Product

### Pit stop: Review product answers (`need_product`)

Review the race engineer's recommended answers. Edit only what you disagree with. Tick the checkbox when satisfied.

### Race engineer: Generate product spec (`ai_product_review`)

The race engineer validates answers for completeness. If sufficient, generates:
- `01_product.md` -- comprehensive product specification
- Design questions in `02_design_questions.md` with pre-filled answers

If answers are insufficient, radios back with follow-up questions (max 3 rounds, 5-6 questions per round) and unchecks the checkbox.

**Output:** Product spec + design questions.

---

## Lap 3: Design

### Pit stop: Review design answers (`need_design`)

Review and edit the design question answers. Tick the checkbox.

### Race engineer: Generate design spec (`ai_design_review`)

The race engineer works as a **Software Architect**. Validates answers, generates:
- `02_design.md` -- detailed design specification
- Implementation questions in `03_plan_questions.md`

**Output:** Design spec + plan questions.

---

## Lap 4: Plan

### Pit stop: Review plan answers (`need_plan`)

Review and edit the implementation question answers. Tick the checkbox.

### Race engineer: Generate implementation plan (`ai_plan_review`)

The race engineer works as a **Software Engineer**. Validates answers, generates:
- `03_plan.md` -- implementation plan with architecture decisions
- `04_execute.md` -- execution playbook with numbered milestones

**Output:** Plan + execution playbook.

---

## Lap 5: Execution

### Pit stop: Review the plan (`need_execution`)

Review the implementation plan and execution playbook. Tick the checkbox to start execution.

### Race engineer: Execute milestones (`ready_to_execute`)

The race engineer executes all milestones continuously as a **Software Engineer**:
1. Reads the milestone description
2. Implements the code
3. Runs build, lint, and tests
4. Commits the changes
5. Moves to the next milestone

Progress is tracked in `04_execute.md` with checkboxes for each milestone.

**Output:** Working code, committed milestone by milestone.

---

## Finish Line: Wrap-up

### Pit stop: Manual tweaks (`fine_tuning`)

Perform any manual adjustments. Tick the checkbox when ready for cleanup.

### Race engineer: Final cleanup (`cleanup_ready`)

Updates project documentation (README, CLAUDE.md), runs final build/lint/test, commits.

### Done (`done`)

Terminal state. Merge the branch manually when ready.

---

## Trivial Tasks

During objective review, the race engineer can flag a task as trivial. Trivial tasks skip the product and design laps entirely:

```
Objective -> Plan -> Execute
```

This is useful for small bug fixes, config changes, or straightforward additions where full product/design analysis would be overkill.

---

## Follow-up Rounds

If the race engineer determines that answers are incomplete or ambiguous, it:
1. Radios back with follow-up questions appended to the current questions file
2. Unchecks the completion checkbox
3. Waits for you to answer and re-tick

Maximum 3 follow-up rounds per lap, with 5-6 questions per round. After 3 rounds, the race engineer proceeds with available information.

---

## State Machine

Each task's state is tracked in `state.yml`:

```yaml
stage: need_product
title: "Add user authentication"
created: "2026-03-31T12:00:00.000Z"
updated: "2026-03-31T14:30:00.000Z"
```

Stages progress linearly:

```
need_objective -> ai_objective_review -> need_product -> ai_product_review ->
need_design -> ai_design_review -> need_plan -> ai_plan_review ->
need_execution -> ready_to_execute -> fine_tuning -> cleanup_ready -> done
```

The `error` state can be entered from any race engineer phase if the session fails. Use `vibe-racer drive --retry` to reprocess.
