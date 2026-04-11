import { spawn } from "child_process";
import path from "path";
import { loadConfig } from "../config/loader.js";
import { checkPrerequisites, checkClaudeCli } from "../config/prerequisites.js";
import { discoverTasks } from "../state/discovery.js";
import { selectTask } from "./task-select.js";
import { isHumanStage } from "../pipeline/states.js";
import { taskBranchName, taskPlanFolder } from "../git/slug.js";
import { chatPrompt } from "../claude/prompts.js";
import type { TaskContext } from "../pipeline/types.js";
import { log } from "../utils/logger.js";

export function spawnClaude(
  systemPrompt: string,
  initialMessage: string,
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "--system-prompt",
        systemPrompt,
        "--append-system-prompt",
        initialMessage,
      ],
      { stdio: "inherit", cwd, env: process.env },
    );

    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        log.warn(`Chat session ended with an error (exit code: ${code})`);
      }
      resolve();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start Claude CLI: ${err.message}`));
    });
  });
}

export async function radioCommand(opts: { task?: number }): Promise<void> {
  const cwd = process.cwd();

  await checkPrerequisites();
  checkClaudeCli();

  const config = loadConfig(cwd);
  const plansDir = path.join(cwd, config.plans_dir);
  const tasks = discoverTasks(plansDir);

  if (tasks.length === 0) {
    log.dim("No tasks found. Run `vibe-racer new` to create one.");
    return;
  }

  const selected = await selectTask({
    tasks,
    filter: isHumanStage,
    taskNumber: opts.task,
    noMatchMessage: "No tasks at a review stage right now.",
    ineligibleMessage: (task) =>
      `Task #${task.number} is at [${task.stage}] — nothing to review right now.`,
  });

  if (!selected) {
    return;
  }

  const task = selected;
  const branchName = taskBranchName(task.number, task.title);
  const planPath = taskPlanFolder(config.plans_dir, task.number, task.title);

  const ctx: TaskContext = {
    taskNumber: task.number,
    title: task.title,
    slug: task.slug,
    plansDir: config.plans_dir,
    planPath,
    branchName,
    cwd,
    contextFiles: config.context,
    repoUrl: config.repo,
    trivial: task.trivial,
  };

  const { systemPrompt, initialMessage } = chatPrompt(ctx, task.stage);
  await spawnClaude(systemPrompt, initialMessage, cwd);
}
