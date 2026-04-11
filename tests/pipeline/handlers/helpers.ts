import { vi } from "vitest";
import type { TaskContext } from "../../../src/pipeline/types.js";

export const CTX: TaskContext = {
  taskNumber: 1,
  title: "Test",
  slug: "test",
  plansDir: "plans",
  planPath: "plans/0001_test",
  branchName: "vibe-racer/0001_test",
  cwd: "/tmp/repo",
  contextFiles: ["README.md"],
};

export function createMocks() {
  const mockRunAndStream = vi.fn().mockResolvedValue("");
  const mockCommitAll = vi.fn().mockResolvedValue("abc123");
  const mockUpdateStage = vi.fn();
  const mockSetError = vi.fn();
  const mockRemoveCompletionMarker = vi.fn();
  const mockCountFollowUpRounds = vi.fn().mockReturnValue(0);
  const mockExistsSync = vi.fn().mockReturnValue(true);

  return {
    mockRunAndStream,
    mockCommitAll,
    mockUpdateStage,
    mockSetError,
    mockRemoveCompletionMarker,
    mockCountFollowUpRounds,
    mockExistsSync,
  };
}
