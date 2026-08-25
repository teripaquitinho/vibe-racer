import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskContext } from "../../../src/pipeline/types.js";

const mockRunAndStream = vi.fn().mockResolvedValue(undefined);
const mockCommitAll = vi.fn().mockResolvedValue("qa123");
const mockUpdateStage = vi.fn();
const mockExistsSync = vi.fn();
const mockEnsureCompletionSection = vi.fn().mockReturnValue(true);

vi.mock("../../../src/claude/session.js", () => ({
  runAndStream: (...args: unknown[]) => mockRunAndStream(...args),
}));

vi.mock("../../../src/claude/prompts.js", () => ({
  qaPrompt: () => ({ prompt: "qa test prompt", persona: "qa test persona" }),
}));

vi.mock("../../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({}),
  commitAll: (...args: unknown[]) => mockCommitAll(...args),
}));

vi.mock("../../../src/state/store.js", () => ({
  updateStage: (...args: unknown[]) => mockUpdateStage(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock("../../../src/pipeline/validation.js", () => ({
  ensureCompletionSection: (...args: unknown[]) => mockEnsureCompletionSection(...args),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dim: vi.fn(),
    guard: vi.fn(),
  },
}));

const CTX: TaskContext = {
  taskNumber: 4,
  title: "Add QA step",
  slug: "add-qa-step",
  plansDir: "plans",
  planPath: "plans/0004_add-qa-step",
  branchName: "vibe-racer/0004_add-qa-step",
  cwd: "/tmp/repo",
  contextFiles: ["README.md"],
};

describe("handleQa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runAndStream with stage ai_qa and the expected allowed tools", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
    await handleQa(CTX);

    expect(mockRunAndStream).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "ai_qa",
        allowedTools: ["Read", "Glob", "Grep", "Write", "Bash"],
        plansDir: "plans",
        taskPlanPath: "plans/0004_add-qa-step",
      }),
    );
  });

  it("throws when 05_qa.md is absent after the session", async () => {
    mockExistsSync.mockReturnValue(false);

    const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
    await expect(handleQa(CTX)).rejects.toThrow("QA session did not produce 05_qa.md");

    // Does NOT advance the stage
    expect(mockUpdateStage).not.toHaveBeenCalled();
  });

  it("appends the completion checkbox on success", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
    await handleQa(CTX);

    expect(mockEnsureCompletionSection).toHaveBeenCalledWith(
      expect.stringContaining("05_qa.md"),
      "Cleanup",
    );
  });

  it("advances to fine_tuning", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
    await handleQa(CTX);

    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0004_add-qa-step", "fine_tuning");
  });

  it("commit message contains 'QA review'", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
    await handleQa(CTX);

    expect(mockCommitAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("QA review"),
      expect.anything(),
    );
  });
});
