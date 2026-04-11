import type { TaskContext } from "../types.js";
import { runAndStream } from "../../claude/session.js";
import { donePrompt } from "../../claude/prompts.js";
import { commitAll, createGit } from "../../git/operations.js";
import { updateStage } from "../../state/store.js";
import { log } from "../../utils/logger.js";

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];

export async function handleDone(ctx: TaskContext): Promise<void> {
  const { prompt, persona } = donePrompt(ctx);

  log.info("Running final docs + cleanup...");
  await runAndStream({
    prompt,
    persona,
    cwd: ctx.cwd,
    allowedTools: ALLOWED_TOOLS,
    stage: "cleanup_ready",
    taskPlanPath: ctx.planPath,
  });

  updateStage(ctx.planPath, "done");
  log.success("Stage advanced to [done]");

  const git = createGit(ctx.cwd);
  const hash = await commitAll(git, `vibe-racer: cleanup for #${ctx.taskNumber}`, ctx.cwd);
  log.success(`Committed: ${hash}`);
  log.success(`Task #${ctx.taskNumber} pipeline complete!`);
}
