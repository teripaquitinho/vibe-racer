import { readdirSync, existsSync } from "fs";
import path from "path";
import { readState } from "./store.js";
import type { Stage } from "./schema.js";

export interface Task {
  number: number;
  slug: string;
  title: string;
  stage: Stage;
  planPath: string;
  trivial?: boolean;
}

const PLAN_DIR_PATTERN = /^(\d{4})_(.+)$/;

export function discoverTasks(plansDir: string): Task[] {
  if (!existsSync(plansDir)) return [];

  const entries = readdirSync(plansDir, { withFileTypes: true });
  const tasks: Task[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(PLAN_DIR_PATTERN);
    if (!match) continue;

    const planPath = path.join(plansDir, entry.name);
    const stateFile = path.join(planPath, "state.yml");
    if (!existsSync(stateFile)) continue;

    try {
      const state = readState(planPath);
      tasks.push({
        number: parseInt(match[1], 10),
        slug: match[2],
        title: state.title,
        stage: state.stage,
        planPath,
        trivial: state.trivial,
      });
    } catch {
      // Skip folders with invalid state.yml
    }
  }

  return tasks.sort((a, b) => a.number - b.number);
}

export function getNextTaskNumber(plansDir: string): number {
  if (!existsSync(plansDir)) return 1;

  const entries = readdirSync(plansDir, { withFileTypes: true });
  let max = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(PLAN_DIR_PATTERN);
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }

  return max + 1;
}
