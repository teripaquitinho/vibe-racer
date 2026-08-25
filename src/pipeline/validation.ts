import { readFile } from "fs/promises";
import { appendFileSync, readFileSync, writeFileSync } from "fs";

interface ValidationResult {
  complete: boolean;
  unanswered: string[];
}

const ANSWER_MARKER = /\*\*Answer:\*\*/i;

export async function validateAnswers(filePath: string): Promise<ValidationResult> {
  const content = await readFile(filePath, "utf-8");
  return validateAnswersFromString(content);
}

function validateAnswersFromString(content: string): ValidationResult {
  const lines = content.split("\n");
  const unanswered: string[] = [];

  let currentQuestion: string | null = null;
  let answerText = "";
  let inAnswer = false;

  for (const line of lines) {
    // Detect question headings (### or numbered bold patterns)
    const questionMatch = line.match(/^###\s+(.+)/) ?? line.match(/^\d+\.\s+\*\*(.+?)\*\*/);
    if (questionMatch) {
      // Flush previous question
      if (currentQuestion && inAnswer) {
        if (isBlankAnswer(answerText)) {
          unanswered.push(currentQuestion);
        }
      }
      currentQuestion = questionMatch[1].replace(/\*\*/g, "").trim();
      answerText = "";
      inAnswer = false;
      continue;
    }

    if (ANSWER_MARKER.test(line)) {
      inAnswer = true;
      // Capture any text after the marker on the same line
      const afterMarker = line.replace(ANSWER_MARKER, "").trim();
      answerText = afterMarker;
      continue;
    }

    if (inAnswer && currentQuestion) {
      // Stop collecting answer if we hit another question or section
      answerText += "\n" + line;
    }
  }

  // Flush last question
  if (currentQuestion && inAnswer) {
    if (isBlankAnswer(answerText)) {
      unanswered.push(currentQuestion);
    }
  }

  return {
    complete: unanswered.length === 0,
    unanswered,
  };
}

function isBlankAnswer(text: string): boolean {
  const cleaned = text
    .replace(/<!--.*?-->/gs, "")
    .replace(/^#\s+Complete\s*$/gim, "")
    .replace(/^-\s*\[[ x]\]\s*Ready to advance\b.*$/gim, "")
    .trim();
  return cleaned.length === 0;
}

// --- Completion marker ---
// Matches: - [x] Ready to advance to <anything>
const CHECKED_MARKER = /^-\s*\[x\]\s*Ready to advance\b/im;

export function completionSection(nextName: string): string {
  return `\n# Complete\n\n- [ ] Ready to advance to ${nextName}\n`;
}

export function completionSectionChecked(nextName: string): string {
  return `\n# Complete\n\n- [x] Ready to advance to ${nextName}\n`;
}

const ANY_MARKER = /^-\s*\[[ x]\]\s*Ready to advance\b/im;

/**
 * Append a completion section only if the file has none. Handlers cannot assume the agent
 * left the file marker-free: a session that mimics the other plan documents writes its own
 * "# Complete" block, and an unconditional append then leaves two checkboxes in one file.
 * Two checkboxes are not cosmetic — at need_decision the second, unticked one is counted as
 * an unworked checklist item, so the task can never advance.
 *
 * Returns true when a section was written.
 */
export function ensureCompletionSection(filePath: string, nextName: string): boolean {
  const content = readFileSync(filePath, "utf-8");
  if (ANY_MARKER.test(content)) return false;
  appendFileSync(filePath, completionSection(nextName), "utf-8");
  return true;
}

export function hasCompletionMarker(filePath: string): boolean {
  const content = readFileSync(filePath, "utf-8");
  return CHECKED_MARKER.test(content);
}

export function countFollowUpRounds(filePath: string): number {
  const content = readFileSync(filePath, "utf-8");
  const matches = content.match(/^## Follow-up Questions/gm);
  return matches ? matches.length : 0;
}

export function validateDecisionChecklist(filePath: string): {
  valid: boolean;
  unchecked: Array<{ line: number; text: string }>;
} {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const unchecked: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    // Leading whitespace is matched on purpose: an indented "- [ ]" is still an unworked
    // item, and anchoring at column 0 would let a nested checklist close a task silently.
    if (/^\s*[-*]\s*\[\s\]/.test(lines[i])) {
      unchecked.push({ line: i + 1, text: lines[i].trim() });
    }
  }
  return { valid: unchecked.length === 0, unchecked };
}

export function removeCompletionMarker(filePath: string): void {
  let content = readFileSync(filePath, "utf-8");
  // Uncheck the checkbox, preserving the text after it. The `g` flag matters: a file that
  // ended up with more than one marker must come back fully unchecked in a single pass,
  // otherwise hasCompletionMarker still sees a tick and the task advances unreviewed.
  content = content.replace(
    /^(-\s*)\[x\](\s*Ready to advance\b.*)/gim,
    "$1[ ]$2",
  );
  writeFileSync(filePath, content, "utf-8");
}
