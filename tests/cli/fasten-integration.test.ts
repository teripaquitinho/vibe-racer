import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { parse } from "yaml";

vi.mock("../../src/claude/session.js", () => ({
  runAndStream: vi.fn().mockResolvedValue("## Summary\nFound 3 items: 2 safe to delete, 1 needs review."),
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

describe("fasten integration", () => {
  let tmpDir: string;
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "fasten-int-"));
    mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, ".vibe-racer.yml"),
      "plans_dir: plans\n",
      "utf-8",
    );
    mkdirSync(path.join(tmpDir, "plans"), { recursive: true });
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("happy path — creates plan folder with trivial state and objective content", async () => {
    const { fastenCommand } = await import("../../src/cli/fasten.js");
    await fastenCommand({});

    const today = new Date().toISOString().slice(0, 10);
    const planDir = path.join(tmpDir, "plans", `0001_fasten-${today}`);

    const stateYml = parse(readFileSync(path.join(planDir, "state.yml"), "utf-8"));
    expect(stateYml.stage).toBe("need_objective");
    expect(stateYml.trivial).toBe(true);
    expect(stateYml.title).toBe(`fasten-${today}`);

    const objective = readFileSync(path.join(planDir, "00_objective.md"), "utf-8");
    expect(objective).toContain("Found 3 items");
    expect(objective).toContain("- [ ] Ready to advance to Plan Questions");
    // Regression: both the template and plan-folder were emitting `# Objective`
    // and `# Complete`, producing duplicated sections. Guard against it.
    expect(objective.match(/^#\s+Objective\b/gm)?.length ?? 0).toBe(1);
    expect(objective.match(/^#\s+Complete\b/gm)?.length ?? 0).toBe(1);
    expect(
      objective.match(/- \[ \] Ready to advance to Plan Questions/g)?.length ?? 0,
    ).toBe(1);
  });

  it("state.yml has trivial: true", async () => {
    const { fastenCommand } = await import("../../src/cli/fasten.js");
    await fastenCommand({});

    const today = new Date().toISOString().slice(0, 10);
    const planDir = path.join(tmpDir, "plans", `0001_fasten-${today}`);

    const stateYml = parse(readFileSync(path.join(planDir, "state.yml"), "utf-8"));
    expect(stateYml.trivial).toBe(true);
  });
});
