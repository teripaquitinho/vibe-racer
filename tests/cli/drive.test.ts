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

class MockSecretDetectedError extends Error {}

vi.mock("../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({}),
  checkoutBranch: vi.fn().mockResolvedValue(undefined),
  commitAll: vi.fn().mockResolvedValue("final123"),
  SecretDetectedError: MockSecretDetectedError,
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

  it("at fine_tuning, waiting-on-human line names 05_qa.md and Cleanup", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "fine_tuning", planPath: "/tmp/plans/0001_test" },
    ]);

    const { driveCommand } = await import("../../src/cli/drive.js");
    await driveCommand({});

    const logger = await import("../../src/utils/logger.js");
    const dimCalls = vi.mocked(logger.log.dim).mock.calls.flat().join(" ");
    expect(dimCalls).toContain("05_qa.md");
    expect(dimCalls).toContain("Cleanup");
  });

  it("at need_decision, waiting-on-human line names 06_decision.md and Done", async () => {
    const { discoverTasks } = await import("../../src/state/discovery.js");
    vi.mocked(discoverTasks).mockReturnValue([
      { number: 1, slug: "test", title: "Test", stage: "need_decision", planPath: "/tmp/plans/0001_test" },
    ]);

    const { driveCommand } = await import("../../src/cli/drive.js");
    await driveCommand({});

    const logger = await import("../../src/utils/logger.js");
    const dimCalls = vi.mocked(logger.log.dim).mock.calls.flat().join(" ");
    expect(dimCalls).toContain("06_decision.md");
    expect(dimCalls).toContain("Done");
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

  describe("reaching done", () => {
    async function adviseDone() {
      const { discoverTasks } = await import("../../src/state/discovery.js");
      vi.mocked(discoverTasks).mockReturnValue([
        { number: 4, slug: "add-qa-step", title: "Add QA step", stage: "need_decision", planPath: "/tmp/plans/0004_add-qa-step" },
      ]);
      const { tryAdvance } = await import("../../src/state/advancement.js");
      vi.mocked(tryAdvance).mockResolvedValue({ advanced: true, reason: "advanced" });
      const { readState } = await import("../../src/state/store.js");
      vi.mocked(readState).mockReturnValue({ stage: "done", title: "Add QA step" });
    }

    it("commits on the task branch when the last checkbox advances a task to done", async () => {
      await adviseDone();

      const { driveCommand } = await import("../../src/cli/drive.js");
      await driveCommand({});

      const git = await import("../../src/git/operations.js");
      expect(git.checkoutBranch).toHaveBeenCalledWith(
        expect.anything(),
        "vibe-racer/0004_add-qa-step",
      );
      expect(git.commitAll).toHaveBeenCalledWith(
        expect.anything(),
        "vibe-racer: task #4 complete",
        expect.anything(),
      );
    });

    it("announces completion", async () => {
      await adviseDone();

      const { driveCommand } = await import("../../src/cli/drive.js");
      await driveCommand({});

      const logger = await import("../../src/utils/logger.js");
      const messages = vi.mocked(logger.log.success).mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes("pipeline complete"))).toBe(true);
    });

    it("does not commit when advancement lands on a non-terminal stage", async () => {
      const { discoverTasks } = await import("../../src/state/discovery.js");
      vi.mocked(discoverTasks).mockReturnValue([
        { number: 4, slug: "t", title: "T", stage: "need_product", planPath: "/tmp/plans/0004_t" },
      ]);
      const { tryAdvance } = await import("../../src/state/advancement.js");
      vi.mocked(tryAdvance).mockResolvedValue({ advanced: true, reason: "advanced" });
      const { readState } = await import("../../src/state/store.js");
      vi.mocked(readState).mockReturnValue({ stage: "ai_product_review", title: "T" });

      const { driveCommand } = await import("../../src/cli/drive.js");
      await driveCommand({});

      const git = await import("../../src/git/operations.js");
      expect(git.commitAll).not.toHaveBeenCalled();
    });

    it("warns instead of crashing when the final commit fails", async () => {
      await adviseDone();
      const git = await import("../../src/git/operations.js");
      vi.mocked(git.commitAll).mockRejectedValueOnce(new Error("index.lock exists"));

      const { driveCommand } = await import("../../src/cli/drive.js");
      await expect(driveCommand({})).resolves.toBeUndefined();

      const logger = await import("../../src/utils/logger.js");
      const warnings = vi.mocked(logger.log.warn).mock.calls.map((c) => String(c[0]));
      expect(warnings.some((m) => m.includes("final commit failed"))).toBe(true);
    });

    it("never buries a secret hit from the final commit", async () => {
      await adviseDone();
      const git = await import("../../src/git/operations.js");
      vi.mocked(git.commitAll).mockRejectedValueOnce(new MockSecretDetectedError("secret"));

      const { driveCommand } = await import("../../src/cli/drive.js");
      await expect(driveCommand({})).rejects.toThrow(MockSecretDetectedError);
    });
  });
});
