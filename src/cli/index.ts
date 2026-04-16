import { Command } from "commander";
import { initCommand } from "./init.js";
import { newCommand } from "./new.js";
import { pitWallCommand } from "./pitwall.js";
import { driveCommand } from "./drive.js";
import { radioCommand } from "./radio.js";
import { fastenCommand } from "./fasten.js";
import { log } from "../utils/logger.js";

function wrapAction<T extends (...args: never[]) => Promise<void>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(message);
      process.exit(1);
    }
  }) as T;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("vibe-racer")
    .description("Your AI race engineer — five laps from objective to shipped code")
    .version("0.2.0");

  program
    .command("init")
    .description("Initialize vibe-racer in the current directory")
    .action(wrapAction(initCommand));

  program
    .command("new")
    .description("Create a new task")
    .argument("<title>", "Task title")
    .option("-d, --desc <text>", "Pre-populate the objective file")
    .action(wrapAction(newCommand));

  program
    .command("pitwall")
    .description("View the pit wall — live status for every car in the race")
    .option("--all", "Include completed tasks")
    .action(wrapAction(pitWallCommand));

  program
    .command("drive")
    .description("Drive the next lap — hand the car to the race engineer for the next stage")
    .option("-t, --task <number>", "Process a specific task number", parseInt)
    .option("--retry", "Retry tasks in error state")
    .action(wrapAction(driveCommand));

  program
    .command("radio")
    .description("Pick up the team radio — open an interactive session with the race engineer at a pit stop")
    .option("-t, --task <number>", "Chat about a specific task", parseInt)
    .action(wrapAction(radioCommand));

  program
    .command("fasten")
    .description("Run dead code analysis and create a cleanup plan")
    .option("--force", "Create a new fasten plan even if an active one exists")
    .action(wrapAction(fastenCommand));

  return program;
}
