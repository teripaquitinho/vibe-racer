import path from "path";
import { loadConfig } from "../config/loader.js";
import { discoverTasks } from "../state/discovery.js";
import { createPlanFolder } from "../state/plan-folder.js";
import { runFastenAnalysis } from "../claude/fasten.js";
import { log } from "../utils/logger.js";

export async function fastenCommand(opts: { force?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = path.join(cwd, config.plans_dir);

  if (!opts.force) {
    const tasks = discoverTasks(plansDir);
    const active = tasks.find(
      (t) => t.slug.startsWith("fasten-") && t.stage !== "done" && t.stage !== "error",
    );
    if (active) {
      log.warn(`An active fasten plan already exists (task #${active.number}).`);
      log.info(
        "Run `vibe-racer drive` to complete it, or use `vibe-racer fasten --force` to create a new one.",
      );
      process.exit(1);
    }
  }

  const result = await runFastenAnalysis(cwd);

  if (result.isEmpty) {
    log.info("No dead code found — nothing to fasten.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const slug = `fasten-${today}`;
  const { taskNumber, folderName } = createPlanFolder({
    title: `fasten-${today}`,
    plansDir,
    slug,
    trivial: true,
    objectiveContent: result.output,
    checkboxLabel: "Plan Questions",
    checked: false,
  });

  log.success(`Task #${taskNumber} created: ${path.join(config.plans_dir, folderName)}`);
  log.info("Review the analysis in 00_objective.md");
  log.info("Tick the checkbox, then run: vibe-racer drive");
}
