# Objective

Add a `vibe-racer fasten` CLI command that runs a dead code analysis via Claude and writes the findings into a new plan's `00_objective.md`, ready for the pipeline to execute.

## Analysis prompt

```
Please perform a dead code analysis on this project. I want to identify code that can be safely removed. Here's what to look for:

1. **Unused exports** – functions, classes, constants, or types that are exported but never imported anywhere in the project.

2. **Unreachable code** – code after unconditional returns, throws, or in branches that can never be true (e.g., `if (false)`, contradictory conditions).

3. **Unused variables and imports** – locally declared variables or imported modules that are never referenced.

4. **Dead feature flags / disabled blocks** – hardcoded flags or config values that permanently disable a code path.

5. **Unused files/modules** – entire files that are never imported or required anywhere in the codebase.

6. **Deprecated internal APIs** – functions or modules that were replaced elsewhere but never deleted.

For each finding, please:
- State the **file path and line number**
- Describe **why it appears dead**
- Give a **confidence level** (high / medium / low) — low confidence means there could be dynamic usage (e.g., reflection, string-based requires, external consumers)
- Suggest whether to **delete, consolidate, or investigate further**

At the end, produce a **prioritized summary** grouped by: safe to delete / needs review / keep but flag.
```

## Expected outcome

`fasten` writes the structured analysis into `00_objective.md` of a new plan folder (`NNNN_fasten-YYYY-MM-DD`), leaving the checkbox unticked. The human reviews the findings, ticks the checkbox, then runs `vibe-racer drive` to advance through the pipeline.

# Complete

- [x] Ready to advance to Objective Review
