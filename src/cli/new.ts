import path from "path";
import { loadConfig } from "../config/loader.js";
import { slugify } from "../git/slug.js";
import { createPlanFolder } from "../state/plan-folder.js";
import { STAGE_NEXT_NAME } from "../pipeline/states.js";
import { log } from "../utils/logger.js";

export async function newCommand(title: string, opts: { desc?: string }): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const plansDir = path.join(cwd, config.plans_dir);
  const nextName = STAGE_NEXT_NAME.need_objective ?? "Next Stage";

  const { taskNumber, folderName } = createPlanFolder({
    title,
    plansDir,
    slug: slugify(title),
    objectiveContent: opts.desc,
    checkboxLabel: nextName,
    checked: Boolean(opts.desc),
  });

  const relPath = path.join(config.plans_dir, folderName);
  log.success(`Task #${taskNumber} created: ${relPath}`);
  if (opts.desc) {
    log.info(`Objective pre-populated and marked ready`);
    log.info(`Run: vibe-racer drive`);
  } else {
    log.info(`Edit your objective: ${relPath}/00_objective.md`);
    log.info(`Then tick the checkbox at the bottom and run: vibe-racer drive`);
  }
}
