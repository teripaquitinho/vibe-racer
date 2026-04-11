import path from "path";
import { existsSync } from "fs";
import type { TaskContext } from "../types.js";
import type { Stage } from "../../state/schema.js";
import { runAndStream } from "../../claude/session.js";
import { MAX_QUESTION_ROUNDS, forcedSpecPrompt } from "../../claude/prompts.js";
import { commitAll, createGit } from "../../git/operations.js";
import { updateStage, setError } from "../../state/store.js";
import { countFollowUpRounds, removeCompletionMarker } from "../validation.js";
import { log } from "../../utils/logger.js";

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write"];

export interface ReviewConfig {
  ctx: TaskContext;
  stage: Stage;
  promptFn: (ctx: TaskContext, round?: number) => { prompt: string; persona: string };
  specFile: string;
  questionsFile: string;
  specDescription: string;
  stageOnRevert: Stage;
  stageOnSuccess: Stage;
  commitMessage: string;
}

export async function handleReviewWithRounds(config: ReviewConfig): Promise<void> {
  const { ctx } = config;
  const questionsFilePath = path.join(ctx.cwd, ctx.planPath, config.questionsFile);
  const followUpCount = countFollowUpRounds(questionsFilePath);
  const currentRound = followUpCount + 1;

  const { prompt, persona } = config.promptFn(ctx, currentRound);

  log.info(`Running review (round ${currentRound})...`);
  await runAndStream({
    prompt,
    persona,
    cwd: ctx.cwd,
    allowedTools: ALLOWED_TOOLS,
    stage: config.stage,
    taskPlanPath: ctx.planPath,
  });

  const git = createGit(ctx.cwd);
  const specFilePath = path.join(ctx.cwd, ctx.planPath, config.specFile);

  if (existsSync(specFilePath)) {
    updateStage(ctx.planPath, config.stageOnSuccess);
    log.success(`Stage advanced to [${config.stageOnSuccess}]`);
    const hash = await commitAll(git, config.commitMessage, ctx.cwd);
    log.success(`Committed: ${hash}`);
    return;
  }

  if (currentRound < MAX_QUESTION_ROUNDS) {
    removeCompletionMarker(questionsFilePath);
    updateStage(ctx.planPath, config.stageOnRevert);
    log.warn(`Follow-up questions added (round ${currentRound}) — stage reverted to [${config.stageOnRevert}]`);
    const hash = await commitAll(git, config.commitMessage, ctx.cwd);
    log.success(`Committed: ${hash}`);
    return;
  }

  // Cap reached — forced re-run
  const hash = await commitAll(git, config.commitMessage, ctx.cwd);
  log.success(`Committed: ${hash}`);

  log.warn(`Round cap reached (${MAX_QUESTION_ROUNDS}). Forcing spec generation...`);
  const { prompt: forcedPrompt, persona: forcedPersona } = forcedSpecPrompt(
    ctx,
    config.specDescription,
    persona,
  );

  await runAndStream({
    prompt: forcedPrompt,
    persona: forcedPersona,
    cwd: ctx.cwd,
    allowedTools: ALLOWED_TOOLS,
    stage: config.stage,
    taskPlanPath: ctx.planPath,
  });

  if (existsSync(specFilePath)) {
    updateStage(ctx.planPath, config.stageOnSuccess);
    log.success(`Stage advanced to [${config.stageOnSuccess}] (after forced re-run)`);
  } else {
    setError(
      ctx.planPath,
      "review-runner",
      `Failed to produce spec after ${MAX_QUESTION_ROUNDS} rounds + forced re-run`,
    );
  }

  await commitAll(git, `vibe-racer: forced spec generation for #${ctx.taskNumber}`, ctx.cwd);

  if (!existsSync(specFilePath)) {
    throw new Error(
      `Failed to produce ${config.specDescription} after ${MAX_QUESTION_ROUNDS} rounds + forced re-run`,
    );
  }
}
