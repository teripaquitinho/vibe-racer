import path from "path";
import { loadConfig } from "../config/loader.js";
import { discoverTasks } from "../state/discovery.js";
import { isAgentStage, isHumanStage } from "../pipeline/states.js";
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
  const humanTasks = tasks.filter((t) => isHumanStage(t.stage));
  const errorTasks = tasks.filter((t) => t.stage === "error");
  const doneTasks = tasks.filter((t) => t.stage === "done");

  if (agentTasks.length > 0) {
    log.info("Waiting on agent:");
    for (const t of agentTasks) {
      const trivialTag = t.trivial === true ? " [trivial]" : "";
      console.log(`  #${t.number} ${t.title}${trivialTag} [${t.stage}]`);
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

  if (agentTasks.length === 0 && humanTasks.length === 0 && errorTasks.length === 0) {
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
