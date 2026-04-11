import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { parse } from "yaml";
import { configSchema, type VibeRacerConfig } from "./schema.js";

export function findProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(dir, ".vibe-racer.yml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "No .vibe-racer.yml found. Run `vibe-racer init` first.",
      );
    }
    dir = parent;
  }
}

export function loadConfig(cwd: string): VibeRacerConfig {
  const root = findProjectRoot(cwd);
  const configPath = path.join(root, ".vibe-racer.yml");
  const raw = parse(readFileSync(configPath, "utf-8"));
  return configSchema.parse(raw ?? {});
}

export function parseRepoUrl(repoUrl: string): {
  owner: string;
  repo: string;
} {
  const match = repoUrl.match(
    /github\.com[/:]([^/]+)\/([^/.]+)/,
  );
  if (!match) {
    throw new Error(`Cannot parse owner/repo from URL: ${repoUrl}`);
  }
  return { owner: match[1], repo: match[2] };
}

export function detectProjectInfo(cwd: string): {
  projectName: string;
  repoUrl: string | undefined;
} {
  const projectName = path.basename(path.resolve(cwd));

  let repoUrl: string | undefined;
  try {
    repoUrl = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    repoUrl = undefined;
  }

  return { projectName, repoUrl };
}
