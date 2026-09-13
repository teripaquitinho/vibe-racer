import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskContext } from "../../../src/pipeline/types.js";

const mockRunAndStream = vi.fn().mockResolvedValue(undefined);
const mockCommitAll = vi.fn().mockResolvedValue("abc123");
const mockReadState = vi.fn();
const mockUpdateStage = vi.fn();
const mockWriteState = vi.fn();
const mockExistsSync = vi.fn();

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
  writeState: (...args: unknown[]) => mockWriteState(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
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

  it("advances to need_plan when 03_plan_questions.md exists and 01_product_questions.md does not", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith("03_plan_questions.md")) return true;
      if (p.endsWith("01_product_questions.md")) return false;
      return false;
    });
    mockReadState.mockReturnValue({
      stage: "ai_objective_review",
      title: "Test",
    });

    const { handleObjectiveReview } = await import(
      "../../../src/pipeline/handlers/objective-review.js"
    );
    await handleObjectiveReview(CTX);

    expect(mockWriteState).toHaveBeenCalledWith(
      expect.stringContaining("plans/0001_test"),
      expect.objectContaining({ trivial: true }),
    );
    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_plan");
  });

  it("advances to need_product when 01_product_questions.md exists (normal flow)", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith("03_plan_questions.md")) return false;
      if (p.endsWith("01_product_questions.md")) return true;
      return false;
    });

    const { handleObjectiveReview } = await import(
      "../../../src/pipeline/handlers/objective-review.js"
    );
    await handleObjectiveReview(CTX);

    expect(mockWriteState).not.toHaveBeenCalled();
    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_product");
  });

  it("advances to need_product when both files exist", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleObjectiveReview } = await import(
      "../../../src/pipeline/handlers/objective-review.js"
    );
    await handleObjectiveReview(CTX);

    expect(mockWriteState).not.toHaveBeenCalled();
    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_product");
  });

  it("advances to need_product when neither file exists", async () => {
    mockExistsSync.mockReturnValue(false);

    const { handleObjectiveReview } = await import(
      "../../../src/pipeline/handlers/objective-review.js"
    );
    await handleObjectiveReview(CTX);

    expect(mockWriteState).not.toHaveBeenCalled();
    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_product");
  });
});
