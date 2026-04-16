import { readFileSync, existsSync } from "fs";
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

