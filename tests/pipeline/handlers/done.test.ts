import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskContext } from "../../../src/pipeline/types.js";

const mockRunAndStream = vi.fn().mockResolvedValue(undefined);
const mockCommitAll = vi.fn().mockResolvedValue("done123");
const mockUpdateStage = vi.fn();
const mockExistsSync = vi.fn();
const mockEnsureCompletionSection = vi.fn().mockReturnValue(true);

vi.mock("../../../src/claude/session.js", () => ({
  runAndStream: (...args: unknown[]) => mockRunAndStream(...args),
}));

vi.mock("../../../src/claude/prompts.js", () => ({
  donePrompt: () => ({ prompt: "done test prompt", persona: "done test persona" }),
  decisionPrompt: () => ({ prompt: "decision test prompt", persona: "decision test persona" }),
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

describe("handleDone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs a second session with stage cleanup_ready and the decision allowed-tools set", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleDone } = await import("../../../src/pipeline/handlers/done.js");
    await handleDone(CTX);

    // Should be called twice: once for cleanup, once for decision
    expect(mockRunAndStream).toHaveBeenCalledTimes(2);

    // Second call is the decision session
    expect(mockRunAndStream).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stage: "cleanup_ready",
        allowedTools: ["Read", "Glob", "Grep", "Write"],
        plansDir: "plans",
        maxTurns: 30,
        jailToPlanDir: true,
      }),
    );
  });

  it("jails the decision session to the plan folder but not the cleanup session", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleDone } = await import("../../../src/pipeline/handlers/done.js");
    await handleDone(CTX);

    // Both share stage cleanup_ready, so the jail cannot come from the stage. Cleanup must
    // stay free to edit docs across the repo; the decision session writes one file.
    const [cleanupCall] = mockRunAndStream.mock.calls[0];
    const [decisionCall] = mockRunAndStream.mock.calls[1];
    expect(cleanupCall.jailToPlanDir).toBeUndefined();
    expect(decisionCall.jailToPlanDir).toBe(true);
  });

  it("throws when 06_decision.md is absent and does not advance the stage", async () => {
    mockExistsSync.mockReturnValue(false);

    const { handleDone } = await import("../../../src/pipeline/handlers/done.js");
    await expect(handleDone(CTX)).rejects.toThrow("Decision session did not produce 06_decision.md");

    expect(mockUpdateStage).not.toHaveBeenCalled();
  });

  it("advances to need_decision, not done", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleDone } = await import("../../../src/pipeline/handlers/done.js");
    await handleDone(CTX);

    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0004_add-qa-step", "need_decision");
  });

  it("commit message contains 'decision checklist'", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleDone } = await import("../../../src/pipeline/handlers/done.js");
    await handleDone(CTX);

    expect(mockCommitAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("decision checklist"),
      expect.anything(),
    );
  });

  it("appends completion checkbox for Done", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleDone } = await import("../../../src/pipeline/handlers/done.js");
    await handleDone(CTX);

    expect(mockEnsureCompletionSection).toHaveBeenCalledWith(
      expect.stringContaining("06_decision.md"),
      "Done",
    );
  });
});
