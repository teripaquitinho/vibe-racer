import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    repo: "https://github.com/owner/repo",
    plans_dir: "plans",
    context: ["README.md"],
  }),
}));

vi.mock("../../src/state/discovery.js", () => ({
  discoverTasks: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({}),
  getVibeRacerBranches: vi.fn().mockResolvedValue([]),
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

describe("pitWallCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides done tasks by default", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "auth", title: "Add auth", stage: "done", planPath: "/tmp/plans/0001_auth" },
      { number: 2, slug: "api", title: "Build API", stage: "need_product", planPath: "/tmp/plans/0002_api" },
    ]);

    const { pitWallCommand } = await import("../../src/cli/pitwall.js");
    await pitWallCommand();

    const logger = await import("../../src/utils/logger.js");
    expect(logger.log.success).not.toHaveBeenCalled();
  });

  it("shows done tasks with --all flag", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "auth", title: "Add auth", stage: "done", planPath: "/tmp/plans/0001_auth" },
    ]);

    const { pitWallCommand } = await import("../../src/cli/pitwall.js");
    await pitWallCommand({ all: true });

    const logger = await import("../../src/utils/logger.js");
    expect(logger.log.success).toHaveBeenCalledWith("Done:");
  });

  it("shows empty-state message when all tasks are done and no --all", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "auth", title: "Add auth", stage: "done", planPath: "/tmp/plans/0001_auth" },
      { number: 2, slug: "api", title: "Build API", stage: "done", planPath: "/tmp/plans/0002_api" },
    ]);

    const { pitWallCommand } = await import("../../src/cli/pitwall.js");
    await pitWallCommand();

    const logger = await import("../../src/utils/logger.js");
    expect(logger.log.dim).toHaveBeenCalledWith(
      expect.stringContaining("No active tasks"),
    );
    expect(logger.log.dim).toHaveBeenCalledWith(
      expect.stringContaining("2 completed tasks"),
    );
  });

  it("renders done section and no empty-state message with --all when all done", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "auth", title: "Add auth", stage: "done", planPath: "/tmp/plans/0001_auth" },
    ]);

    const { pitWallCommand } = await import("../../src/cli/pitwall.js");
    await pitWallCommand({ all: true });

    const logger = await import("../../src/utils/logger.js");
    expect(logger.log.success).toHaveBeenCalledWith("Done:");
    expect(logger.log.dim).toHaveBeenCalledWith(
      expect.stringContaining("No active tasks"),
    );
  });

  it("shows only active tasks when mix of active and done, no --all", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "auth", title: "Add auth", stage: "done", planPath: "/tmp/plans/0001_auth" },
      { number: 2, slug: "api", title: "Build API", stage: "ai_objective_review", planPath: "/tmp/plans/0002_api" },
      { number: 3, slug: "ui", title: "Build UI", stage: "need_design", planPath: "/tmp/plans/0003_ui" },
    ]);

    const { pitWallCommand } = await import("../../src/cli/pitwall.js");
    await pitWallCommand();

    const logger = await import("../../src/utils/logger.js");
    expect(logger.log.info).toHaveBeenCalledWith("Waiting on agent:");
    expect(logger.log.info).toHaveBeenCalledWith("Waiting on human:");
    expect(logger.log.success).not.toHaveBeenCalled();
    expect(logger.log.dim).not.toHaveBeenCalledWith(
      expect.stringContaining("No active tasks"),
    );
  });

  it("renders [trivial] tag for trivial tasks", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "fix", title: "Fix bug", stage: "need_plan", planPath: "/tmp/plans/0001_fix", trivial: true },
    ]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { pitWallCommand } = await import("../../src/cli/pitwall.js");
    await pitWallCommand();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[trivial]"),
    );
    consoleSpy.mockRestore();
  });

  it("uses singular form for 1 completed task", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "auth", title: "Add auth", stage: "done", planPath: "/tmp/plans/0001_auth" },
    ]);

    const { pitWallCommand } = await import("../../src/cli/pitwall.js");
    await pitWallCommand();

    const logger = await import("../../src/utils/logger.js");
    expect(logger.log.dim).toHaveBeenCalledWith(
      expect.stringContaining("1 completed task."),
    );
  });
});
