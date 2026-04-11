import path from "path";
import { loadConfig } from "../config/loader.js";
import { checkPrerequisites } from "../config/prerequisites.js";
import { discoverTasks } from "../state/discovery.js";
import { tryAdvance } from "../state/advancement.js";
import { readState } from "../state/store.js";
import { isAgentStage, isHumanStage, STAGE_QUESTIONS_FILE, STAGE_NEXT_NAME } from "../pipeline/states.js";
import { createGit, checkoutBranch } from "../git/operations.js";
import { taskBranchName, taskPlanFolder } from "../git/slug.js";
import { dispatch } from "../pipeline/machine.js";
import type { TaskContext } from "../pipeline/types.js";
import { log } from "../utils/logger.js";
import { selectTask } from "./task-select.js";
import type { Stage } from "../state/schema.js";

export async function driveCommand(opts: {
  task?: number;
  retry?: boolean;
}): Promise<void> {
  const cwd = process.cwd();

  log.info("Running prerequisite checks...");
  await checkPrerequisites();

  const config = loadConfig(cwd);
  const plansDir = path.join(cwd, config.plans_dir);

  const tasks = discoverTasks(plansDir);

  if (tasks.length === 0) {
    log.dim("No tasks found. Run `vibe-racer new` to create one.");
    return;
  }

  // Try advancing human-stage tasks based on checkbox in local files.
  for (const task of tasks) {
    if (isHumanStage(task.stage)) {
      const result = await tryAdvance(
        taskPlanFolder(config.plans_dir, task.number, task.title),
        task.stage,
        cwd,
      );
      if (result.advanced) {
        log.success(`Task #${task.number} advanced from [${task.stage}]`);
        task.stage = readState(task.planPath).stage;
      }
    }
  }

  const filter = (stage: Stage) =>
    isAgentStage(stage) || (opts.retry === true && stage === "error");

  const ineligibleMessage = (t: { number: number; stage: Stage }) => {
    if (t.stage === "error" && !opts.retry) {
      return `Task #${t.number} is in error state. Use --retry to reprocess.`;
    }
    return `Task #${t.number} is at [${t.stage}] — waiting on human, not agent.`;
  };

  const selected = await selectTask({
    tasks,
    filter,
    taskNumber: opts.task,
    noMatchMessage: "No actionable tasks.",
    ineligibleMessage,
  });

  if (!selected) {
    if (opts.task === undefined) {
      const humanTasks = tasks.filter((t) => isHumanStage(t.stage));
      if (humanTasks.length > 0) {
        log.dim("Waiting on human input:");
        for (const t of humanTasks) {
          const qFile = STAGE_QUESTIONS_FILE[t.stage];
          const nextName = STAGE_NEXT_NAME[t.stage];
          const hint = nextName ? `"Ready to advance to ${nextName}"` : "the checkbox";
          log.dim(`  #${t.number} [${t.stage}] — tick ${hint} in ${qFile ?? "the questions file"}`);
        }
      } else {
        log.dim("Nothing to do.");
      }
    }
    return;
  }

  const task = selected;
  const branchName = taskBranchName(task.number, task.title);
  const planPath = taskPlanFolder(config.plans_dir, task.number, task.title);

  // Checkout branch
  const git = createGit(cwd);
  log.info(`Checking out branch: ${branchName}`);
  await checkoutBranch(git, branchName);

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

  log.info(`Dispatching handler for [${task.stage}]...`);
  await dispatch(task.stage, ctx);
}
