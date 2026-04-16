import { readFile } from "fs/promises";
import { readFileSync, writeFileSync } from "fs";

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

export function hasCompletionMarker(filePath: string): boolean {
  const content = readFileSync(filePath, "utf-8");
  return CHECKED_MARKER.test(content);
}

export function countFollowUpRounds(filePath: string): number {
  const content = readFileSync(filePath, "utf-8");
  const matches = content.match(/^## Follow-up Questions/gm);
  return matches ? matches.length : 0;
}

export function removeCompletionMarker(filePath: string): void {
  let content = readFileSync(filePath, "utf-8");
  // Uncheck the checkbox, preserving the text after it
  content = content.replace(
    /^(-\s*)\[x\](\s*Ready to advance\b.*)/im,
    "$1[ ]$2",
  );
  writeFileSync(filePath, content, "utf-8");
}
