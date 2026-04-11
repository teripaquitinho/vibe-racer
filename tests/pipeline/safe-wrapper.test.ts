import { describe, it, expect, vi } from "vitest";
import { withErrorHandling } from "../../src/pipeline/handlers/safe-wrapper.js";
import type { TaskContext } from "../../src/pipeline/types.js";

const mockSetError = vi.fn();
const mockCommitAll = vi.fn().mockResolvedValue("abc123");

vi.mock("../../src/state/store.js", () => ({
  setError: (...args: unknown[]) => mockSetError(...args),
}));

vi.mock("../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({}),
  commitAll: (...args: unknown[]) => mockCommitAll(...args),
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
  it("passes through on success", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withErrorHandling("test-handler", handler);
    await wrapped(CTX);
    expect(handler).toHaveBeenCalledWith(CTX);
    expect(mockSetError).not.toHaveBeenCalled();
  });

  it("sets error state on failure", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withErrorHandling("test-handler", handler);

    await expect(wrapped(CTX)).rejects.toThrow("boom");
    expect(mockSetError).toHaveBeenCalledWith("plans/0001_test", "test-handler", "boom");
  });

  it("attempts to commit partial work on failure", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("fail"));
    const wrapped = withErrorHandling("test-handler", handler);

    await expect(wrapped(CTX)).rejects.toThrow("fail");
    expect(mockCommitAll).toHaveBeenCalled();
  });

  it("re-throws the original error", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("original"));
    const wrapped = withErrorHandling("test-handler", handler);

    await expect(wrapped(CTX)).rejects.toThrow("original");
  });
});
