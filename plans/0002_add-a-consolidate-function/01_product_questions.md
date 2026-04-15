# Product Questions for #2: Add a consolidate function

> **Role**: Senior Product Designer
> **Stage**: `ai_objective_review` → `need_product`
> **Date**: 2026-04-15

---

## Scope and Trigger

### Q1: What does "consolidate" actually mean as a user action?

The objective bundles two distinct things: (a) running a dead-code analysis, and (b) creating a new vibe-racer plan from the results. Should `vibe-racer consolidate` do both in one shot, or should it be a single command that only performs the analysis and writes the objective — leaving `vibe-racer drive` to pick it up afterwards?

**Answer:**
Single command that does both: runs the analysis via Claude, then calls the equivalent of `vibe-racer new "consolidate-code-YYYY-MM-DD"` and writes the analysis results directly into `00_objective.md` as a pre-filled objective with the checkbox already ticked. The user then runs `vibe-racer drive` to advance the plan through the normal pipeline. This keeps `consolidate` focused on producing the analysis artifact and lets the existing pipeline handle execution. The user's pit-stop review happens at the product-questions stage, not before the analysis runs.

---

## Output and Presentation

### Q2: What should the analysis output look like in the objective file?

The suggested prompt produces a detailed report with file paths, line numbers, confidence levels, and a prioritized summary. Should the objective contain the full raw analysis, or should it be structured into an actionable objective that the pipeline can reason about?

**Answer:**
The objective file should contain a structured, actionable format — not a raw dump. It should have: (1) a brief summary paragraph stating total findings by category, (2) a "Safe to delete" section listing items with high confidence, (3) a "Needs review" section for medium/low confidence, and (4) a "Keep but flag" section. Each item should include file path, line number, why it appears dead, and confidence level. This structure doubles as both the analysis report and a clear objective that the pipeline can turn into an implementation plan.

---

## Workflow Integration

### Q3: Should the created plan be marked as trivial or go through the full 5-lap pipeline?

Dead code removal is typically a straightforward change — the analysis itself is the hard part, and `consolidate` handles that. Should the generated plan skip product and design laps (trivial fast-path), or go through the full pipeline?

**Answer:**
Mark it as trivial. By the time the analysis is written into the objective, the "product" and "design" decisions are already made — it's a list of things to delete or consolidate. The plan should skip straight to plan questions (lap 3), where the engineer decides execution order, batch size, and how to validate nothing breaks. The user can always override trivial to false if the consolidation turns out to be more complex than expected.

---

### Q4: How should the command name and date slug work?

The objective mentions `vibe-racer new "consolidate-code-[date]"`. Should the CLI command be `vibe-racer consolidate` with no arguments, or should it accept a custom suffix? And what date format for the slug?

**Answer:**
The command should be `vibe-racer consolidate` with no required arguments. The plan folder name should follow the existing `NNNN_slug` convention, auto-generating as e.g. `0003_consolidate-code-2026-04-15`. No custom suffix needed — if the user wants a custom name, they can use `vibe-racer new` manually. The date format in the slug should be `YYYY-MM-DD` for sortability.

---

## Safety and Edge Cases

### Q5: What happens if the user runs `consolidate` on a project with no dead code, or on a very large project?

Two edge cases: (a) the analysis finds nothing actionable, and (b) the analysis on a large codebase produces an enormous report. How should the command handle these?

**Answer:**
(a) If the analysis finds zero issues, do not create a plan folder. Print a message like "No dead code found — nothing to consolidate." and exit cleanly. (b) For large projects, cap the analysis at the most impactful 50 findings, prioritized by confidence level (high first) and grouped by category. Include a note at the bottom of the objective stating "N additional low-confidence findings omitted — re-run with `--thorough` to include all." This keeps the generated plan digestible while leaving an escape hatch for comprehensive sweeps.

---

### Q6: Should `consolidate` be aware of existing consolidation plans?

If the user runs `vibe-racer consolidate` twice in a row — maybe because new dead code was introduced — should it warn about or reference a previous consolidation plan that hasn't been completed yet?

**Answer:**
Yes. Before running the analysis, check for any existing `consolidate-code-*` plans that are not in a `done` stage. If one exists, print a warning: "An active consolidation plan already exists (task #N). Run `vibe-racer drive` to complete it, or use `--force` to create a new one." This prevents plan sprawl and nudges the user to finish what they started. With `--force`, create a new plan regardless.

---

# Complete

- [ ] Ready to advance to Product Review
