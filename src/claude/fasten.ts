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

function sanitizeOutput(output: string): string {
  let text = output.trim();
  // Strip leading ```...``` fence if the model wrapped the response.
  text = text.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```\s*$/, "");
  // Strip any model preamble/filler before the anchor line. The prompt
  // instructs the model to start with "Dead code analysis for this project"
  // but models occasionally prefix with filler like "Here's the analysis:".
  const anchorIdx = text.search(/^Dead code analysis for this project/m);
  if (anchorIdx > 0) {
    text = text.slice(anchorIdx);
  }
  // Strip a leading `# Objective` heading (caller adds its own).
  text = text.replace(/^#\s+Objective\s*\n+/i, "");
  // Strip any trailing `# Complete` section (caller adds its own).
  text = text.replace(/\n#\s+Complete[\s\S]*$/i, "");
  return text.trim();
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

Your response MUST be ONLY the markdown body below. Do NOT include:
- any preamble, greeting, or filler (e.g., "Here's the analysis:", "I've analyzed...", "Sure!")
- any commentary before or after the body
- any code fences around the response
- a \`# Objective\` heading or \`# Complete\` section (the caller adds them)

The FIRST CHARACTER of your response must be the literal letter \`D\` in \`Dead code analysis for this project\`. End the response with the last table row.

Use this exact two-section template:

Dead code analysis for this project — run by \`vibe-racer fasten\` on ${new Date().toISOString().slice(0, 10)}.

## Summary

{Total findings count by category. e.g., "Found 12 items: 7 safe to delete, 5 need review."}

## Safe to Delete

Items with **high confidence** that can be removed without risk.

| # | File | Line | Type | Why it appears dead | Action |
|---|------|------|------|---------------------|--------|
| 1 | ... | ... | ... | ... | Delete |

## Needs Review

Items that are not clearly safe to delete — medium/low confidence, exported-only-for-tests, public API surface, or potential dynamic usage. Include a short note explaining what to verify or why it might be kept.

| # | File | Line | Type | Why it appears dead | Confidence | Note |
|---|------|------|------|---------------------|------------|------|
| 1 | ... | ... | ... | ... | Medium | ... |

If a section has no findings, leave the table with header rows only (no data rows).

If you find **no dead code at all** across any category, write "No dead code found." in the Summary section and leave all tables empty.
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

  const cleaned = sanitizeOutput(output);
  return { output: cleaned, isEmpty: isEmptyAnalysis(cleaned) };
}
