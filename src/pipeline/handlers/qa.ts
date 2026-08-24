import path from "path";
import { existsSync, appendFileSync } from "node:fs";
import type { TaskContext } from "../types.js";
import { runAndStream } from "../../claude/session.js";
import { qaPrompt } from "../../claude/prompts.js";
import { commitAll, createGit } from "../../git/operations.js";
import { updateStage } from "../../state/store.js";
import { completionSection } from "../validation.js";
import { log } from "../../utils/logger.js";

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write", "Bash"];
const MAX_TURNS = 60;

export async function handleQa(ctx: TaskContext): Promise<void> {
  const { prompt, persona } = qaPrompt(ctx);

  await runAndStream({
    prompt,
    persona,
    cwd: ctx.cwd,
    allowedTools: ALLOWED_TOOLS,
    stage: "ai_qa",
    taskPlanPath: ctx.planPath,
    plansDir: ctx.plansDir,
    maxTurns: MAX_TURNS,
  });

  // Verify 05_qa.md was written before advancing. Advancing without it strands the task:
  // fine_tuning points at 05_qa.md, tryAdvance returns no_questions_file, and there is no
  // forward path.
  const qaPath = path.join(ctx.cwd, ctx.planPath, "05_qa.md");
  if (!existsSync(qaPath)) {
    throw new Error("QA session did not produce 05_qa.md");
  }

  appendFileSync(qaPath, completionSection("Cleanup"), "utf-8");

  updateStage(ctx.planPath, "fine_tuning");

  const git = createGit(ctx.cwd);
  const hash = await commitAll(git, `vibe-racer: QA review for #${ctx.taskNumber}`, ctx.cwd);
  if (hash) log.success(`Committed: ${hash}`);

  log.info("Review QA findings in 05_qa.md, then tick the checkbox.");
}
