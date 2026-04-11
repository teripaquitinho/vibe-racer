import { select } from "@inquirer/prompts";
import type { Task } from "../state/discovery.js";
import type { Stage } from "../state/schema.js";
import { log } from "../utils/logger.js";

export interface SelectTaskOptions {
  tasks: Task[];
  filter: (stage: Stage) => boolean;
  taskNumber?: number;
  noMatchMessage: string;
  notFoundMessage?: string;
  ineligibleMessage?: (task: Task) => string;
}

export async function selectTask(
  opts: SelectTaskOptions,
): Promise<Task | null> {
  if (opts.taskNumber !== undefined) {
    const found = opts.tasks.find((t) => t.number === opts.taskNumber);
    if (!found) {
      log.error(opts.notFoundMessage ?? `Task #${opts.taskNumber} not found.`);
      return null;
    }
    if (!opts.filter(found.stage)) {
      if (opts.ineligibleMessage) {
        log.warn(opts.ineligibleMessage(found));
      } else {
        log.warn(`Task #${found.number} is not eligible.`);
      }
      return null;
    }
    return found;
  }

  const eligible = opts.tasks.filter((t) => opts.filter(t.stage));

  if (eligible.length === 0) {
    log.dim(opts.noMatchMessage);
    return null;
  }

  if (eligible.length === 1) {
    const task = eligible[0];
    log.info(`Found 1 actionable task: #${task.number} ${task.title} [${task.stage}]`);
    return task;
  }

  const choice = await select({
    message: "Which task to process?",
    choices: eligible.map((t) => ({
      name: `#${t.number} ${t.title} [${t.stage}]`,
      value: t.number,
    })),
  });

  return eligible.find((t) => t.number === choice) ?? null;
}
