import path from "path";
import { readFile, writeFile } from "fs/promises";
import type { TaskContext } from "../types.js";
import { runAndStream } from "../../claude/session.js";
import { executeMilestonePrompt } from "../../claude/prompts.js";
import { commitAll, createGit } from "../../git/operations.js";
import { updateStage } from "../../state/store.js";
import { log } from "../../utils/logger.js";

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];

function countPendingMilestones(content: string): number {
  return (content.match(/\|\s*`?pending`?\s*\|/gi) || []).length;
}

export async function handleExecute(ctx: TaskContext): Promise<void> {
  const git = createGit(ctx.cwd);
  const playbookPath = path.join(ctx.cwd, ctx.planPath, "04_execute.md");
  let milestone = 1;

  while (true) {
    const content = await readFile(playbookPath, "utf-8");
    const pending = countPendingMilestones(content);
    if (pending === 0) break;

    const { prompt, persona } = executeMilestonePrompt(ctx);

    log.info(`Executing milestone ${milestone} (${pending} remaining)...`);
    await runAndStream({
      prompt,
      persona,
      cwd: ctx.cwd,
      allowedTools: ALLOWED_TOOLS,
      stage: "ready_to_execute",
      taskPlanPath: ctx.planPath,
    });

    const hash = await commitAll(git, `vibe-racer: milestone ${milestone} for #${ctx.taskNumber}`, ctx.cwd);
    if (hash) {
      log.success(`Milestone ${milestone} committed: ${hash}`);
    } else {
      log.dim(`Milestone ${milestone} — agent already committed`);
    }
    milestone++;
  }

  // Replace the execution checkbox with the cleanup checkbox for human review
  const finalContent = await readFile(playbookPath, "utf-8");
  const updatedContent = finalContent.replace(
    /^-\s*\[x\]\s*Ready to advance to Execution\s*$/im,
    "- [ ] Ready to advance to Cleanup",
  );
  await writeFile(playbookPath, updatedContent, "utf-8");

  updateStage(ctx.planPath, "fine_tuning");
  log.success("All milestones complete — stage advanced to [fine_tuning]");

  const closeHash = await commitAll(git, `vibe-racer: execution complete for #${ctx.taskNumber}`, ctx.cwd);
  if (closeHash) {
    log.success(`Committed: ${closeHash}`);
  } else {
    log.dim("No changes to commit after execution");
  }
}
