import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/config/prerequisites.js", () => ({
  checkPrerequisites: vi.fn().mockResolvedValue(undefined),
}));

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

vi.mock("../../src/state/advancement.js", () => ({
  tryAdvance: vi.fn().mockResolvedValue({ advanced: false, reason: "no_marker" }),
}));

vi.mock("../../src/state/store.js", () => ({
  readState: vi.fn().mockReturnValue({ stage: "need_objective" }),
}));

vi.mock("../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({}),
  checkoutBranch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/pipeline/machine.js", () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
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

describe("driveCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exits gracefully when no tasks found", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([]);

    const { driveCommand } = await import("../../src/cli/drive.js");
    await driveCommand({});

    const logger = await import("../../src/utils/logger.js");
    expect(logger.log.dim).toHaveBeenCalledWith(
      expect.stringContaining("No tasks found"),
    );
  });

  it("exits gracefully when no actionable tasks", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "need_objective", planPath: "/tmp/plans/0001_test" },
    ]);

    const { driveCommand } = await import("../../src/cli/drive.js");
    await driveCommand({});

    const logger = await import("../../src/utils/logger.js");
    expect(logger.log.dim).toHaveBeenCalledWith(
      expect.stringContaining("Waiting on human input"),
    );
  });
});
