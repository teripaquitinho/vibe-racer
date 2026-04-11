import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn().mockReturnValue(Buffer.from("ok")),
}));

vi.mock("../../src/config/prerequisites.js", () => ({
  checkPrerequisites: vi.fn().mockResolvedValue(undefined),
  checkClaudeCli: vi.fn(),
}));

vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    repo: "https://github.com/owner/repo",
    plans_dir: "plans",
    context: ["README.md", "CLAUDE.md"],
  }),
}));

vi.mock("../../src/state/discovery.js", () => ({
  discoverTasks: vi.fn().mockReturnValue([]),
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

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
}));

import { radioCommand, spawnClaude } from "../../src/cli/radio.js";
import { checkPrerequisites, checkClaudeCli } from "../../src/config/prerequisites.js";
import { discoverTasks } from "../../src/state/discovery.js";
import { log } from "../../src/utils/logger.js";
import { spawn } from "child_process";
import { PERSONAS } from "../../src/claude/prompts.js";

function makeFakeChild(): ChildProcess {
  const emitter = new EventEmitter();
  return emitter as unknown as ChildProcess;
}

describe("radioCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls checkPrerequisites and checkClaudeCli", async () => {
    vi.mocked(discoverTasks).mockReturnValue([]);

    await radioCommand({});

    expect(checkPrerequisites).toHaveBeenCalled();
    expect(checkClaudeCli).toHaveBeenCalled();
  });

  it("prints 'No tasks found' when no tasks exist", async () => {
    vi.mocked(discoverTasks).mockReturnValue([]);

    await radioCommand({});

    expect(log.dim).toHaveBeenCalledWith(
      expect.stringContaining("No tasks found"),
    );
  });

  it("prints 'No tasks at a review stage' when all tasks are at agent stages", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "ai_objective_review", planPath: "/tmp/plans/0001_test" },
    ]);

    await radioCommand({});

    expect(log.dim).toHaveBeenCalledWith(
      "No tasks at a review stage right now.",
    );
  });

  it("prints ineligible message when --task N targets an agent-stage task", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "ai_objective_review", planPath: "/tmp/plans/0001_test" },
    ]);

    await radioCommand({ task: 1 });

    expect(log.warn).toHaveBeenCalledWith(
      "Task #1 is at [ai_objective_review] — nothing to review right now.",
    );
  });

  it("prints not-found when --task N doesn't exist", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "need_plan", planPath: "/tmp/plans/0001_test" },
    ]);

    await radioCommand({ task: 99 });

    expect(log.error).toHaveBeenCalledWith("Task #99 not found.");
  });

  it("spawns claude with correct args for a need_plan task", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "need_plan", planPath: "/tmp/plans/0001_test" },
    ]);

    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const promise = radioCommand({});
    // Let the spawn happen, then emit close
    await new Promise((r) => setTimeout(r, 10));
    fakeChild.emit("close", 0);
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--system-prompt", "--append-system-prompt"]),
      expect.objectContaining({ stdio: "inherit" }),
    );

    const spawnArgs = vi.mocked(spawn).mock.calls[0];
    const args = spawnArgs[1] as string[];
    const systemPromptIdx = args.indexOf("--system-prompt");
    const appendIdx = args.indexOf("--append-system-prompt");
    expect(args[systemPromptIdx + 1]).toContain(PERSONAS.softwareEngineer);
    expect(args[appendIdx + 1]).toContain("plans/0001_test");
  });

  it("spawns claude with correct args for a need_product task", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 2, slug: "feat", title: "Feature", stage: "need_product", planPath: "/tmp/plans/0002_feat" },
    ]);

    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const promise = radioCommand({});
    await new Promise((r) => setTimeout(r, 10));
    fakeChild.emit("close", 0);
    await promise;

    const spawnArgs = vi.mocked(spawn).mock.calls[0];
    const systemPrompt = spawnArgs[1][1] as string;
    expect(systemPrompt).toContain(PERSONAS.productDesigner);
  });

  it("spawns claude with stdio: 'inherit' and correct cwd", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "need_plan", planPath: "/tmp/plans/0001_test" },
    ]);

    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const promise = radioCommand({});
    await new Promise((r) => setTimeout(r, 10));
    fakeChild.emit("close", 0);
    await promise;

    const spawnOpts = vi.mocked(spawn).mock.calls[0][2];
    expect(spawnOpts).toMatchObject({
      stdio: "inherit",
      cwd: process.cwd(),
    });
  });

  it("resolves without error on exit code 0", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "need_plan", planPath: "/tmp/plans/0001_test" },
    ]);

    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const promise = radioCommand({});
    await new Promise((r) => setTimeout(r, 10));
    fakeChild.emit("close", 0);

    await expect(promise).resolves.toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("logs warning on non-zero exit code but still resolves", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "need_plan", planPath: "/tmp/plans/0001_test" },
    ]);

    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild);

    const promise = radioCommand({});
    await new Promise((r) => setTimeout(r, 10));
    fakeChild.emit("close", 1);

    await expect(promise).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("exit code: 1"),
    );
  });
});
