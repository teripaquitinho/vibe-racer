import path from "path";
import type { TaskContext } from "../types.js";
import { runAndStream } from "../../claude/session.js";
import { objectiveReviewPrompt } from "../../claude/prompts.js";
import { commitAll, createGit } from "../../git/operations.js";
import { readState, updateStage } from "../../state/store.js";
import { log } from "../../utils/logger.js";

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write"];

export async function handleObjectiveReview(ctx: TaskContext): Promise<void> {
  const { prompt, persona } = objectiveReviewPrompt(ctx);

  log.info("Running objective review...");
  await runAndStream({
    prompt,
    persona,
    cwd: ctx.cwd,
    allowedTools: ALLOWED_TOOLS,
    stage: "ai_objective_review",
    taskPlanPath: ctx.planPath,
  });

  const updatedState = readState(path.resolve(ctx.cwd, ctx.planPath));
  if (updatedState.trivial === true) {
    updateStage(ctx.planPath, "need_plan");
    log.info("Task classified as trivial — skipping product and design stages");
  } else {
    updateStage(ctx.planPath, "need_product");
    log.success("Stage advanced to [need_product]");
  }

  const git = createGit(ctx.cwd);
  const hash = await commitAll(git, `vibe-racer: objective review for #${ctx.taskNumber}`, ctx.cwd);
  log.success(`Committed: ${hash}`);
}
