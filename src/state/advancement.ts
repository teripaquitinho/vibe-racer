import path from "path";
import { existsSync } from "fs";
import type { Stage } from "./schema.js";
import { updateStage } from "./store.js";
import { STAGE_QUESTIONS_FILE, nextStage } from "../pipeline/states.js";
import {
  hasCompletionMarker,
  removeCompletionMarker,
  validateAnswers,
} from "../pipeline/validation.js";
import { log } from "../utils/logger.js";

interface AdvancementResult {
  advanced: boolean;
  reason: "no_questions_file" | "no_marker" | "incomplete_answers" | "advanced";
}

export async function tryAdvance(
  planPath: string,
  currentStage: Stage,
  cwd: string,
): Promise<AdvancementResult> {
  const questionsFile = STAGE_QUESTIONS_FILE[currentStage];
  if (!questionsFile) {
    return { advanced: false, reason: "no_questions_file" };
  }

  const filePath = path.join(cwd, planPath, questionsFile);
  if (!existsSync(filePath)) {
    return { advanced: false, reason: "no_questions_file" };
  }

  if (!hasCompletionMarker(filePath)) {
    return { advanced: false, reason: "no_marker" };
  }

  const validation = await validateAnswers(filePath);
  if (!validation.complete) {
    removeCompletionMarker(filePath);
    log.warn(
      `Incomplete answers in ${questionsFile}:\n${validation.unanswered.map((q) => `  - ${q}`).join("\n")}`,
    );
    return { advanced: false, reason: "incomplete_answers" };
  }

  const next = nextStage(currentStage);
  if (next) {
    updateStage(path.join(cwd, planPath), next);
  }

  return { advanced: true, reason: "advanced" };
}
