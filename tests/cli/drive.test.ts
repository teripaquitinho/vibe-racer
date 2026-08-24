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
  updateStage: vi.fn(),
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

  it("--retry with valid error_stage restores and dispatches once", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "error" as any, planPath: "/tmp/plans/0001_test" },
    ]);

    const { readState, updateStage } = await import("../../src/state/store.js");
    vi.mocked(readState).mockReturnValue({
      stage: "error",
      title: "Test",
      error_stage: "ai_product_review",
      error_message: "context exceeded",
    } as any);

    const { dispatch } = await import("../../src/pipeline/machine.js");

    const { driveCommand } = await import("../../src/cli/drive.js");
    await driveCommand({ task: 1, retry: true });

    expect(updateStage).toHaveBeenCalledWith("/tmp/plans/0001_test", "ai_product_review");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("ai_product_review", expect.anything());
  });

  it("--retry with legacy handler-name error_stage prints message without throwing", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "error" as any, planPath: "/tmp/plans/0001_test" },
    ]);

    const { readState } = await import("../../src/state/store.js");
    vi.mocked(readState).mockReturnValue({
      stage: "error",
      title: "Test",
      error_stage: "design-review",
      error_message: "failed",
    } as any);

    const { dispatch } = await import("../../src/pipeline/machine.js");

    const { driveCommand } = await import("../../src/cli/drive.js");
    await driveCommand({ task: 1, retry: true });

    const logger = await import("../../src/utils/logger.js");
    expect(logger.log.error).toHaveBeenCalledWith(
      expect.stringContaining("design-review"),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
});
