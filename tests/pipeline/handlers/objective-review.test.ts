import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskContext } from "../../../src/pipeline/types.js";

const mockRunAndStream = vi.fn().mockResolvedValue(undefined);
const mockCommitAll = vi.fn().mockResolvedValue("abc123");
const mockReadState = vi.fn();
const mockUpdateStage = vi.fn();

vi.mock("../../../src/claude/session.js", () => ({
  runAndStream: (...args: unknown[]) => mockRunAndStream(...args),
}));

vi.mock("../../../src/claude/prompts.js", () => ({
  objectiveReviewPrompt: () => ({ prompt: "test prompt", persona: "test persona" }),
}));

vi.mock("../../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({}),
  commitAll: (...args: unknown[]) => mockCommitAll(...args),
}));

vi.mock("../../../src/state/store.js", () => ({
  readState: (...args: unknown[]) => mockReadState(...args),
  updateStage: (...args: unknown[]) => mockUpdateStage(...args),
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
  taskNumber: 1,
  title: "Test",
  slug: "test",
  plansDir: "plans",
  planPath: "plans/0001_test",
  branchName: "vibe-racer/0001_test",
  cwd: "/tmp/repo",
  contextFiles: ["README.md"],
};

describe("handleObjectiveReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("advances to need_plan when task is trivial", async () => {
    mockReadState.mockReturnValue({
      stage: "ai_objective_review",
      title: "Test",
      trivial: true,
    });

    const { handleObjectiveReview } = await import(
      "../../../src/pipeline/handlers/objective-review.js"
    );
    await handleObjectiveReview(CTX);

    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_plan");
  });

  it("advances to need_product when task is not trivial", async () => {
    mockReadState.mockReturnValue({
      stage: "ai_objective_review",
      title: "Test",
    });

    const { handleObjectiveReview } = await import(
      "../../../src/pipeline/handlers/objective-review.js"
    );
    await handleObjectiveReview(CTX);

    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_product");
  });
});
