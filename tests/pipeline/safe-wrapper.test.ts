import { describe, it, expect, vi, beforeEach } from "vitest";
import { withErrorHandling } from "../../src/pipeline/handlers/safe-wrapper.js";
import type { TaskContext } from "../../src/pipeline/types.js";

const mockSetError = vi.fn();
const mockCommitAll = vi.fn().mockResolvedValue("abc123");

const { MockSecretDetectedError } = vi.hoisted(() => {
  class MockSecretDetectedError extends Error {
    constructor(public readonly matches: Array<{ file: string; reason: string }>) {
      super("Secret scan blocked commit");
      this.name = "SecretDetectedError";
    }
  }
  return { MockSecretDetectedError };
});

vi.mock("../../src/state/store.js", () => ({
  setError: (...args: unknown[]) => mockSetError(...args),
}));

vi.mock("../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({}),
  commitAll: (...args: unknown[]) => mockCommitAll(...args),
  SecretDetectedError: MockSecretDetectedError,
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

const CTX: TaskContext = {
  taskNumber: 1,
  title: "Test",
  slug: "test",
  plansDir: "plans",
  planPath: "plans/0001_test",
  branchName: "vibe-racer/0001_test",
  cwd: "/tmp/repo",
  contextFiles: ["README.md"],
};

describe("withErrorHandling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommitAll.mockResolvedValue("abc123");
  });

  it("passes through on success", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withErrorHandling("ready_to_execute", handler);
    await wrapped(CTX);
    expect(handler).toHaveBeenCalledWith(CTX);
    expect(mockSetError).not.toHaveBeenCalled();
  });

  it("sets error state on failure", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withErrorHandling("ready_to_execute", handler);

    await expect(wrapped(CTX)).rejects.toThrow("boom");
    expect(mockSetError).toHaveBeenCalledWith("plans/0001_test", "ready_to_execute", "boom");
  });

  it("attempts to commit partial work on failure", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("fail"));
    const wrapped = withErrorHandling("ready_to_execute", handler);

    await expect(wrapped(CTX)).rejects.toThrow("fail");
    expect(mockCommitAll).toHaveBeenCalled();
  });

  it("re-throws the original error", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("original"));
    const wrapped = withErrorHandling("ready_to_execute", handler);

    await expect(wrapped(CTX)).rejects.toThrow("original");
  });

  it("passes ctx.cwd to commitAll for secret scanning", async () => {
    mockCommitAll.mockResolvedValue("abc123");
    const handler = vi.fn().mockRejectedValue(new Error("fail"));
    const wrapped = withErrorHandling("ready_to_execute", handler);

    await expect(wrapped(CTX)).rejects.toThrow("fail");
    expect(mockCommitAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("partial work"),
      CTX.cwd,
    );
  });

  it("re-throws SecretDetectedError from commitAll without setting error state", async () => {
    const secretErr = new MockSecretDetectedError([{ file: "creds.json", reason: "API key" }]);
    mockCommitAll.mockRejectedValue(secretErr);
    const handler = vi.fn().mockRejectedValue(new Error("original"));
    const wrapped = withErrorHandling("ready_to_execute", handler);

    await expect(wrapped(CTX)).rejects.toThrow("Secret scan blocked commit");
    expect(mockSetError).not.toHaveBeenCalled();
  });
});
