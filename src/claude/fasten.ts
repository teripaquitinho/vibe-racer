import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runAndStream } from "./session.js";

export interface FastenAnalysisResult {
  output: string;
  isEmpty: boolean;
}

function isEmptyAnalysis(output: string): boolean {
  return /no dead code found/i.test(output);
}

function buildPrompt(cwd: string): string {
  let context = "";

  const readmePath = path.join(cwd, "README.md");
  if (existsSync(readmePath)) {
    context += `## Project README\n\n${readFileSync(readmePath, "utf-8")}\n\n`;
  }

  const claudeMdPath = path.join(cwd, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    context += `## Project CLAUDE.md\n\n${readFileSync(claudeMdPath, "utf-8")}\n\n`;
  }

  const contextSection = context
    ? `# Project Context\n\n${context}---\n\n`
    : "";

  return `${contextSection}# Dead Code Analysis

Analyze this codebase for dead code. Look for these 6 categories:

1. **Unused exports** — exported functions, classes, types, or constants that are never imported anywhere
2. **Unreachable code** — code after returns, breaks, or in branches that can never execute
3. **Unused variables and imports** — declared variables or imported modules that are never referenced
4. **Dead feature flags / disabled blocks** — conditionals that always evaluate to the same branch, commented-out features
5. **Unused files/modules** — entire files that are never imported or referenced
6. **Deprecated internal APIs** — internal functions or methods that have been replaced but not removed

For each finding, include:
- File path
- Line number
- Why it appears dead
- Confidence level (high / medium / low)
- Recommended action (delete, consolidate, or investigate)

## Output Format

Write your findings using this exact template:

\`\`\`
# Objective

Dead code analysis for this project — run by \`vibe-racer fasten\` on ${new Date().toISOString().slice(0, 10)}.

## Summary

{Total findings count by category. e.g., "Found 12 items: 7 safe to delete, 3 need review, 2 to keep but flag."}

## Safe to Delete

Items with **high confidence** that can be removed without risk.

| # | File | Line | Type | Why it appears dead | Action |
|---|------|------|------|---------------------|--------|
| 1 | ... | ... | ... | ... | Delete |

## Needs Review

Items with **medium or low confidence** — may have dynamic usage, reflection, or external consumers.

| # | File | Line | Type | Why it appears dead | Confidence | Action |
|---|------|------|------|---------------------|------------|--------|
| 1 | ... | ... | ... | ... | Medium | Investigate |

## Keep but Flag

Items that are technically dead but should be preserved for now (e.g., public API surface, upcoming feature flags).

| # | File | Line | Type | Why it's flagged | Reason to keep |
|---|------|------|------|------------------|----------------|
\`\`\`

If a section has no findings, leave the table with header rows only (no data rows).

If you find **no dead code at all** across any category, write "No dead code found." in the Summary section and leave all tables empty.

# Complete

- [ ] Ready to advance to Plan Questions
`;
}

export async function runFastenAnalysis(cwd: string): Promise<FastenAnalysisResult> {
  const prompt = buildPrompt(cwd);

  const output = await runAndStream({
    prompt,
    persona: "",
    cwd,
    allowedTools: ["Read", "Glob", "Grep"],
    stage: "ai_objective_review",
    taskPlanPath: "",
  });

  if (!output) {
    throw new Error("Analysis failed. Run vibe-racer fasten again to retry.");
  }

  return { output, isEmpty: isEmptyAnalysis(output) };
}
