import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMocks, CTX } from "./helpers.js";

const mocks = createMocks();

vi.mock("../../../src/claude/session.js", () => ({
  runAndStream: (...args: unknown[]) => mocks.mockRunAndStream(...args),
}));

vi.mock("../../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({}),
  commitAll: (...args: unknown[]) => mocks.mockCommitAll(...args),
}));

vi.mock("../../../src/state/store.js", () => ({
  updateStage: (...args: unknown[]) => mocks.mockUpdateStage(...args),
  setError: (...args: unknown[]) => mocks.mockSetError(...args),
}));

vi.mock("../../../src/pipeline/validation.js", () => ({
  countFollowUpRounds: (...args: unknown[]) => mocks.mockCountFollowUpRounds(...args),
  removeCompletionMarker: (...args: unknown[]) => mocks.mockRemoveCompletionMarker(...args),
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

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mocks.mockExistsSync(...args),
  };
});

const mockPromptFn = vi.fn().mockReturnValue({
  prompt: "test prompt",
  persona: "test persona",
});

function makeConfig(overrides = {}) {
  return {
    ctx: CTX,
    promptFn: mockPromptFn,
    specFile: "01_product.md",
    questionsFile: "01_product_questions.md",
    specDescription: "product specification",
    stageOnRevert: "need_product" as const,
    stageOnSuccess: "need_design" as const,
    commitMessage: "vibe-racer: product review for #1",
    ...overrides,
  };
}

describe("handleReviewWithRounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockRunAndStream.mockResolvedValue("");
    mocks.mockCommitAll.mockResolvedValue("abc123");
    mocks.mockCountFollowUpRounds.mockReturnValue(0);
    mocks.mockExistsSync.mockReturnValue(true);
    mockPromptFn.mockReturnValue({ prompt: "test prompt", persona: "test persona" });
  });

  it("normal flow (round 1, spec produced) — advances stage", async () => {
    mocks.mockCountFollowUpRounds.mockReturnValue(0);
    mocks.mockExistsSync.mockReturnValue(true);

    const { handleReviewWithRounds } = await import(
      "../../../src/pipeline/handlers/review-runner.js"
    );
    await handleReviewWithRounds(makeConfig());

    expect(mockPromptFn).toHaveBeenCalledWith(CTX, 1);
    expect(mocks.mockRunAndStream).toHaveBeenCalledTimes(1);
    expect(mocks.mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_design");
    expect(mocks.mockRemoveCompletionMarker).not.toHaveBeenCalled();
  });

  it("follow-up flow (round 1, no spec) — reverts stage and removes marker", async () => {
    mocks.mockCountFollowUpRounds.mockReturnValue(0);
    mocks.mockExistsSync.mockReturnValue(false);

    const { handleReviewWithRounds } = await import(
      "../../../src/pipeline/handlers/review-runner.js"
    );
    await handleReviewWithRounds(makeConfig());

    expect(mockPromptFn).toHaveBeenCalledWith(CTX, 1);
    expect(mocks.mockRemoveCompletionMarker).toHaveBeenCalled();
    expect(mocks.mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_product");
  });

  it("follow-up flow (round 2, no spec) — reverts with correct round", async () => {
    mocks.mockCountFollowUpRounds.mockReturnValue(1);
    mocks.mockExistsSync.mockReturnValue(false);

    const { handleReviewWithRounds } = await import(
      "../../../src/pipeline/handlers/review-runner.js"
    );
    await handleReviewWithRounds(makeConfig());

    expect(mockPromptFn).toHaveBeenCalledWith(CTX, 2);
    expect(mocks.mockRemoveCompletionMarker).toHaveBeenCalled();
    expect(mocks.mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_product");
  });

  it("cap reached, agent produces spec (round 3) — advances normally", async () => {
    mocks.mockCountFollowUpRounds.mockReturnValue(2);
    mocks.mockExistsSync.mockReturnValue(true);

    const { handleReviewWithRounds } = await import(
      "../../../src/pipeline/handlers/review-runner.js"
    );
    await handleReviewWithRounds(makeConfig());

    expect(mockPromptFn).toHaveBeenCalledWith(CTX, 3);
    expect(mocks.mockRunAndStream).toHaveBeenCalledTimes(1);
    expect(mocks.mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_design");
  });

  it("cap reached, forced re-run succeeds — advances after two agent calls", async () => {
    mocks.mockCountFollowUpRounds.mockReturnValue(2);
    mocks.mockExistsSync
      .mockReturnValueOnce(false) // first spec check — missing
      .mockReturnValueOnce(true); // second spec check — produced by forced re-run

    const { handleReviewWithRounds } = await import(
      "../../../src/pipeline/handlers/review-runner.js"
    );
    await handleReviewWithRounds(makeConfig());

    expect(mocks.mockRunAndStream).toHaveBeenCalledTimes(2);
    expect(mocks.mockCommitAll).toHaveBeenCalledTimes(2);
    expect(mocks.mockCommitAll).toHaveBeenLastCalledWith(
      expect.anything(),
      "vibe-racer: forced spec generation for #1",
      expect.anything(),
    );
    expect(mocks.mockUpdateStage).toHaveBeenCalledWith("plans/0001_test", "need_design");
    expect(mocks.mockSetError).not.toHaveBeenCalled();
  });

  it("cap reached, forced re-run also fails — sets error and throws", async () => {
    mocks.mockCountFollowUpRounds.mockReturnValue(2);
    mocks.mockExistsSync.mockReturnValue(false);

    const { handleReviewWithRounds } = await import(
      "../../../src/pipeline/handlers/review-runner.js"
    );

    await expect(handleReviewWithRounds(makeConfig())).rejects.toThrow(
      "Failed to produce product specification after 3 rounds + forced re-run",
    );

    expect(mocks.mockRunAndStream).toHaveBeenCalledTimes(2);
    expect(mocks.mockSetError).toHaveBeenCalledWith(
      "plans/0001_test",
      "review-runner",
      "Failed to produce spec after 3 rounds + forced re-run",
    );
  });
});
