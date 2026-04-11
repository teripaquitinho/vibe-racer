import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { stringify } from "yaml";
import { loadConfig } from "../config/loader.js";
import { getNextTaskNumber } from "../state/discovery.js";
import { slugify } from "../git/slug.js";
import type { TaskState } from "../state/schema.js";
import { completionSection, completionSectionChecked } from "../pipeline/validation.js";
import { STAGE_NEXT_NAME } from "../pipeline/states.js";
import { log } from "../utils/logger.js";

export async function newCommand(title: string, opts: { desc?: string }): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  const plansDir = path.join(cwd, config.plans_dir);
  const taskNumber = getNextTaskNumber(plansDir);
  const slug = slugify(title);
  const folderName = `${String(taskNumber).padStart(4, "0")}_${slug}`;
  const planDir = path.join(plansDir, folderName);

  mkdirSync(planDir, { recursive: true });

  // Write objective
  const objectivePath = path.join(planDir, "00_objective.md");
  const hasDesc = Boolean(opts.desc);
  const body = opts.desc ?? "> Write your objective here.";
  const nextName = STAGE_NEXT_NAME.need_objective ?? "Next Stage";
  const section = hasDesc ? completionSectionChecked(nextName) : completionSection(nextName);
  writeFileSync(
    objectivePath,
    `# Objective\n\n${body}\n${section}`,
    "utf-8",
  );

  // Write initial state
  const state: TaskState = {
    stage: "need_objective",
    title,
    created: new Date().toISOString(),
  };
  writeFileSync(path.join(planDir, "state.yml"), stringify(state), "utf-8");

  const relPath = path.join(config.plans_dir, folderName);
  log.success(`Task #${taskNumber} created: ${relPath}`);
  if (hasDesc) {
    log.info(`Objective pre-populated and marked ready`);
    log.info(`Run: vibe-racer drive`);
  } else {
    log.info(`Edit your objective: ${relPath}/00_objective.md`);
    log.info(`Then tick the checkbox at the bottom and run: vibe-racer drive`);
  }
}
