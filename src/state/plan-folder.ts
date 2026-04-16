import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { stringify } from "yaml";
import { getNextTaskNumber } from "./discovery.js";
import type { TaskState } from "./schema.js";
import { completionSection, completionSectionChecked } from "../pipeline/validation.js";

interface CreatePlanOptions {
  title: string;
  plansDir: string;
  slug: string;
  trivial?: boolean;
  objectiveContent?: string;
  checkboxLabel: string;
  checked?: boolean;
}

interface CreatedPlan {
  taskNumber: number;
  folderName: string;
  planDir: string;
}

export function createPlanFolder(options: CreatePlanOptions): CreatedPlan {
  const taskNumber = getNextTaskNumber(options.plansDir);
  const folderName = `${String(taskNumber).padStart(4, "0")}_${options.slug}`;
  const planDir = path.join(options.plansDir, folderName);

  mkdirSync(planDir, { recursive: true });

  const body = options.objectiveContent ?? "> Write your objective here.";
  const section = options.checked
    ? completionSectionChecked(options.checkboxLabel)
    : completionSection(options.checkboxLabel);
  writeFileSync(
    path.join(planDir, "00_objective.md"),
    `# Objective\n\n${body}\n${section}`,
    "utf-8",
  );

  const state: TaskState = {
    stage: "need_objective",
    title: options.title,
    created: new Date().toISOString(),
  };
  if (options.trivial !== undefined) {
    state.trivial = options.trivial;
  }
  writeFileSync(path.join(planDir, "state.yml"), stringify(state), "utf-8");

  return { taskNumber, folderName, planDir };
}
