import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "fs";
import os from "os";
import path from "path";

vi.mock("../../src/config/prerequisites.js", () => ({
  checkPrerequisites: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({
    init: vi.fn().mockResolvedValue(undefined),
  }),
  getRemoteUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/utils/logger.js", () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dim: vi.fn(),
    guard: vi.fn(),
  },
}));

describe("CLI", () => {
  it("--help lists all commands", () => {
    const output = execSync("npx tsx src/index.ts --help", {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(output).toContain("init");
    expect(output).toContain("new");
    expect(output).toContain("pitwall");
    expect(output).toContain("drive");
    expect(output).toContain("radio");
    expect(output).toContain("fasten");
  });

  it("init --help shows init description", () => {
    const output = execSync("npx tsx src/index.ts init --help", {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(output).toContain("Initialize");
  });

  it("drive --help shows --task option", () => {
    const output = execSync("npx tsx src/index.ts drive --help", {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(output).toContain("--task");
    expect(output).toContain("--retry");
  });
});

describe("init scaffold content", () => {
  let tmpDir: string;
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "jugg-init-"));
    mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scaffolds README.md and CLAUDE.md with standard sections", async () => {
    const { initCommand } = await import("../../src/cli/init.js");
    await initCommand();

    const readme = readFileSync(path.join(tmpDir, "README.md"), "utf-8");
    expect(readme).toContain("## Install");
    expect(readme).toContain("## Quick start");
    expect(readme).toContain("## Commands");
    expect(readme).toContain("## Configuration");
    expect(readme).toContain("## Environment variables");

    const claude = readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claude).toContain("## What this is");
    expect(claude).toContain("## Project structure");
    expect(claude).toContain("## Key decisions");
    expect(claude).toContain("## Commands");
    expect(claude).toContain("## Tech stack");
  });

  it("uses directory name in scaffold headings", async () => {
    const { initCommand } = await import("../../src/cli/init.js");
    await initCommand();

    const dirName = path.basename(tmpDir);
    const readme = readFileSync(path.join(tmpDir, "README.md"), "utf-8");
    expect(readme).toMatch(new RegExp(`^# ${dirName}`));

    const claude = readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(claude).toMatch(new RegExp(`^# ${dirName}`));
  });
});
