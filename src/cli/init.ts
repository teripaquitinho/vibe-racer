import { writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { stringify } from "yaml";
import { input } from "@inquirer/prompts";
import { checkPrerequisites } from "../config/prerequisites.js";
import { createGit, getRemoteUrl } from "../git/operations.js";
import { log } from "../utils/logger.js";

function readmeScaffold(projectName: string): string {
  return `# ${projectName}\n\nTODO: describe your project\n\n## Install\n\nTODO: add install instructions\n\n## Quick start\n\nTODO: add quick start\n\n## Commands\n\nTODO: add command reference\n\n## Configuration\n\nTODO: add configuration reference\n\n## Environment variables\n\nTODO: add environment variables\n`;
}

function claudeScaffold(projectName: string): string {
  return `# ${projectName}\n\n## What this is\n\nTODO: describe your project\n\n## Project structure\n\nTODO: add project structure tree\n\n## Key decisions\n\nTODO: add key decisions\n\n## Commands\n\nTODO: add dev commands\n\n## Tech stack\n\nTODO: add tech stack\n`;
}

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();

  log.info("Checking prerequisites...");
  await checkPrerequisites();

  // Ensure git repo exists
  const gitDir = path.join(cwd, ".git");
  if (!existsSync(gitDir)) {
    log.info("No git repository found — initializing...");
    const git = createGit(cwd);
    await git.init();
    log.success("Git repository initialized");
  }

  // Detect or ask for repo URL
  const git = createGit(cwd);
  let repoUrl = await getRemoteUrl(git);

  if (!repoUrl) {
    repoUrl = await input({
      message: "GitHub repo URL (leave blank to skip):",
    });
    if (repoUrl.trim() === "") {
      repoUrl = null;
    }
  } else {
    log.info(`Detected repo: ${repoUrl}`);
  }

  // Write config
  const configPath = path.join(cwd, ".vibe-racer.yml");
  if (!existsSync(configPath)) {
    const config: Record<string, unknown> = {};
    if (repoUrl) {
      config.repo = repoUrl;
    }
    writeFileSync(configPath, stringify(config), "utf-8");
    log.success(`Config written: ${configPath}`);
  } else {
    log.dim("Config already exists, skipping");
  }

  // Create plans directory
  const plansDir = path.join(cwd, "plans");
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
    log.dim("Created plans/ directory");
  }

  // Create scaffold docs if missing
  const projectName = path.basename(cwd);
  const scaffolds: Record<string, string> = {
    "README.md": readmeScaffold(projectName),
    "CLAUDE.md": claudeScaffold(projectName),
  };
  for (const [file, content] of Object.entries(scaffolds)) {
    const filePath = path.join(cwd, file);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, "utf-8");
      log.dim(`Created scaffold: ${file}`);
    }
  }

  log.success("Initialization complete!");
  log.guard("Security: canUseTool path-jail enabled (project root only)");
  log.info("Next: Run `vibe-racer new \"Your task title\"` to create a task");
  log.info("Then: Run `vibe-racer drive` to start the pipeline");
}
