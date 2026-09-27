import path from "path";
import { loadConfig } from "../config/loader.js";
import { discoverTasks } from "../state/discovery.js";
import { isAgentStage, isHumanStage, STAGE_QUESTIONS_FILE } from "../pipeline/states.js";
import type { Task } from "../state/discovery.js";
import { getVibeRacerBranches, createGit } from "../git/operations.js";
import { log } from "../utils/logger.js";

export async function pitWallCommand(options: { all?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  const plansDir = path.join(cwd, config.plans_dir);
  const tasks = discoverTasks(plansDir);

  if (tasks.length === 0) {
    log.dim("No tasks found. Run `vibe-racer new` to create one.");
    return;
  }

  const agentTasks = tasks.filter((t) => isAgentStage(t.stage));
  // `need_operator` is a human stage, so it must be excluded here or a paused task is listed
  // twice — once in its own group and once as an ordinary pit stop.
  const operatorTasks = tasks.filter((t) => t.stage === "need_operator");
  const humanTasks = tasks.filter(
    (t) => isHumanStage(t.stage) && t.stage !== "need_operator",
  );
  const errorTasks = tasks.filter((t) => t.stage === "error");
  const doneTasks = tasks.filter((t) => t.stage === "done");

  if (agentTasks.length > 0) {
    log.info("Waiting on agent:");
    for (const t of agentTasks) {
      const trivialTag = t.trivial === true ? " [trivial]" : "";
      console.log(`  #${t.number} ${t.title}${trivialTag} [${t.stage}]`);
    }
  }

  // Above the ordinary pit-stop group: a pause blocks a lap that was already paid for.
  // Neutral styling throughout — a pause is the pipeline working as designed, never an error.
  if (operatorTasks.length > 0) {
    log.info("Waiting on operator:");
    for (const t of operatorTasks) {
      console.log(`  #${t.number} ${t.title}${pausedAt(t)}`);
      console.log(`     → edit ${playbookPath(t, cwd)}`);
    }
  }

  if (humanTasks.length > 0) {
    log.info("Waiting on human:");
    for (const t of humanTasks) {
      const trivialTag = t.trivial === true ? " [trivial]" : "";
      console.log(`  #${t.number} ${t.title}${trivialTag} [${t.stage}]`);
    }
  }

  if (errorTasks.length > 0) {
    log.warn("Errors:");
    for (const t of errorTasks) {
      const trivialTag = t.trivial === true ? " [trivial]" : "";
      console.log(`  #${t.number} ${t.title}${trivialTag} [error]`);
    }
  }

  if (options.all && doneTasks.length > 0) {
    log.success("Done:");
    for (const t of doneTasks) {
      const trivialTag = t.trivial === true ? " [trivial]" : "";
      console.log(`  #${t.number} ${t.title}${trivialTag}`);
    }
  }

  if (
    agentTasks.length === 0 &&
    operatorTasks.length === 0 &&
    humanTasks.length === 0 &&
    errorTasks.length === 0
  ) {
    if (doneTasks.length > 0) {
      const n = doneTasks.length;
      log.dim(`No active tasks. Use --all to see ${n} completed task${n === 1 ? "" : "s"}.`);
    }
  }

  // Check for orphan branches
  const git = createGit(cwd);
  const branches = await getVibeRacerBranches(git);
  const taskNumbers = new Set(tasks.map((t) => t.number));

  const orphans = branches.filter((b) => {
    const match = b.match(/^vibe-racer\/(\d+)_/);
    if (!match) return true;
    return !taskNumbers.has(parseInt(match[1], 10));
  });

  if (orphans.length > 0) {
    log.warn("Orphan branches (no matching task):");
    for (const branch of orphans) {
      console.log(`  ${branch}`);
    }
  }
}

/**
 * Milestone and reason, straight off the task — the CLI layer never parses a plan file, so a
 * malformed playbook can never break the pit board.
 */
function pausedAt(task: Task): string {
  const parts = [task.operatorMilestone, task.operatorReason].filter(
    (p): p is string => p !== undefined && p.trim() !== "",
  );
  return parts.length === 0 ? " — paused" : ` — paused at ${parts.join(": ")}`;
}

function playbookPath(task: Task, cwd: string): string {
  const file = STAGE_QUESTIONS_FILE.need_operator?.file ?? "04_execute.md";
  return path.join(path.relative(cwd, task.planPath), file);
}
