import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    plans_dir: "plans",
    context: ["README.md", "CLAUDE.md"],
  }),
}));

vi.mock("../../src/state/discovery.js", () => ({
  discoverTasks: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/state/plan-folder.js", () => ({
  createPlanFolder: vi.fn().mockReturnValue({
    taskNumber: 3,
    folderName: "0003_fasten-2026-04-15",
    planDir: "/tmp/plans/0003_fasten-2026-04-15",
  }),
}));

vi.mock("../../src/claude/fasten.js", () => ({
  runFastenAnalysis: vi.fn().mockResolvedValue({
    output: "## Summary\nFound 5 items.",
    isEmpty: false,
  }),
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

describe("fastenCommand", () => {
  let fastenCommand: typeof import("../../src/cli/fasten.js").fastenCommand;
  let discoverTasks: typeof import("../../src/state/discovery.js").discoverTasks;
  let createPlanFolder: typeof import("../../src/state/plan-folder.js").createPlanFolder;
  let runFastenAnalysis: typeof import("../../src/claude/fasten.js").runFastenAnalysis;
  let log: typeof import("../../src/utils/logger.js").log;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    ({ fastenCommand } = await import("../../src/cli/fasten.js"));
    ({ discoverTasks } = await import("../../src/state/discovery.js"));
    ({ createPlanFolder } = await import("../../src/state/plan-folder.js"));
    ({ runFastenAnalysis } = await import("../../src/claude/fasten.js"));
    ({ log } = await import("../../src/utils/logger.js"));

    vi.mocked(discoverTasks).mockReturnValue([]);
    vi.mocked(createPlanFolder).mockReturnValue({
      taskNumber: 3,
      folderName: "0003_fasten-2026-04-15",
      planDir: "/tmp/plans/0003_fasten-2026-04-15",
    });
    vi.mocked(runFastenAnalysis).mockResolvedValue({
      output: "## Summary\nFound 5 items.",
      isEmpty: false,
    });
  });

  it("happy path — calls runFastenAnalysis, creates plan, prints success", async () => {
    await fastenCommand({});

    expect(runFastenAnalysis).toHaveBeenCalledOnce();
    expect(createPlanFolder).toHaveBeenCalledWith(
      expect.objectContaining({ trivial: true }),
    );
    expect(log.success).toHaveBeenCalledWith(
      expect.stringContaining("Task #3 created"),
    );
  });

  it("createPlanFolder receives slug with today's date", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await fastenCommand({});

    expect(createPlanFolder).toHaveBeenCalledWith(
      expect.objectContaining({ slug: `fasten-${today}` }),
    );
  });

  it("createPlanFolder receives checkboxLabel and checked: false", async () => {
    await fastenCommand({});

    expect(createPlanFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        checkboxLabel: "Plan Questions",
        checked: false,
      }),
    );
  });

  it("zero findings — no plan created, prints clean message", async () => {
    vi.mocked(runFastenAnalysis).mockResolvedValue({
      output: "No dead code found.",
      isEmpty: true,
    });

    await fastenCommand({});

    expect(createPlanFolder).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith("No dead code found — nothing to fasten.");
  });

  it("duplicate detection — exits with code 1 when active fasten plan exists", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      {
        number: 2,
        slug: "fasten-2026-04-14",
        title: "fasten-2026-04-14",
        stage: "need_plan",
        planPath: "/tmp/plans/0002_fasten-2026-04-14",
      },
    ]);

    await expect(fastenCommand({})).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("active fasten plan already exists"),
    );
    expect(runFastenAnalysis).not.toHaveBeenCalled();
  });

  it("duplicate detection with --force — skips check, proceeds normally", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      {
        number: 2,
        slug: "fasten-2026-04-14",
        title: "fasten-2026-04-14",
        stage: "need_plan",
        planPath: "/tmp/plans/0002_fasten-2026-04-14",
      },
    ]);

    await fastenCommand({ force: true });

    expect(runFastenAnalysis).toHaveBeenCalledOnce();
    expect(createPlanFolder).toHaveBeenCalledOnce();
  });

  it("duplicate detection ignores done and error stage fasten plans", async () => {
    vi.mocked(discoverTasks).mockReturnValue([
      {
        number: 1,
        slug: "fasten-2026-04-13",
        title: "fasten-2026-04-13",
        stage: "done",
        planPath: "/tmp/plans/0001_fasten-2026-04-13",
      },
      {
        number: 2,
        slug: "fasten-2026-04-14",
        title: "fasten-2026-04-14",
        stage: "error",
        planPath: "/tmp/plans/0002_fasten-2026-04-14",
      },
    ]);

    await fastenCommand({});

    expect(runFastenAnalysis).toHaveBeenCalledOnce();
    expect(createPlanFolder).toHaveBeenCalledOnce();
  });

  it("runFastenAnalysis error propagates", async () => {
    vi.mocked(runFastenAnalysis).mockRejectedValue(
      new Error("Analysis failed. Run vibe-racer fasten again to retry."),
    );

    await expect(fastenCommand({})).rejects.toThrow("Analysis failed");
  });
});
