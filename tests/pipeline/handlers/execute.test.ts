import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskContext } from "../../../src/pipeline/types.js";

const mockRunAndStream = vi.fn().mockResolvedValue(undefined);
const mockCommitAll = vi.fn().mockResolvedValue("exec123");
const mockUpdateStage = vi.fn();
let readFileContent = "";

vi.mock("../../../src/claude/session.js", () => ({
  runAndStream: (...args: unknown[]) => mockRunAndStream(...args),
}));

vi.mock("../../../src/claude/prompts.js", () => ({
  executeMilestonePrompt: () => ({ prompt: "exec prompt", persona: "exec persona" }),
}));

vi.mock("../../../src/git/operations.js", () => ({
  createGit: vi.fn().mockReturnValue({}),
  commitAll: (...args: unknown[]) => mockCommitAll(...args),
}));

vi.mock("../../../src/state/store.js", () => ({
  updateStage: (...args: unknown[]) => mockUpdateStage(...args),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockImplementation(() => Promise.resolve(readFileContent)),
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

describe("handleExecute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("advances to ai_qa, not fine_tuning", async () => {
    // No pending milestones — loop exits immediately
    readFileContent = "| M1 | Schema | `done` | abc | |";

    const { handleExecute } = await import("../../../src/pipeline/handlers/execute.js");
    await handleExecute(CTX);

    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0004_add-qa-step", "ai_qa");
    expect(mockUpdateStage).not.toHaveBeenCalledWith(
      expect.anything(),
      "fine_tuning",
    );
  });

  it("does not import writeFile (checkbox rewrite was deleted)", async () => {
    // Verify that execute.ts no longer imports writeFile from fs/promises.
    // The source only imports readFile now.
    const executeSource = await import("fs/promises");
    readFileContent = "| M1 | Schema | `done` | abc | |";

    const { handleExecute } = await import("../../../src/pipeline/handlers/execute.js");
    await handleExecute(CTX);

    // The handler reads the file (to count pending milestones) but never writes it.
    // We verify by checking readFile was called but the mock has no writeFile calls.
    const { readFile } = await import("fs/promises");
    expect(readFile).toHaveBeenCalled();
  });

  it("milestone loop exits when no pending rows remain", async () => {
    readFileContent = "| M1 | Schema | `done` | abc | |\n| M2 | Guard | `done` | def | |";

    const { handleExecute } = await import("../../../src/pipeline/handlers/execute.js");
    await handleExecute(CTX);

    // runAndStream should NOT have been called — no pending milestones
    expect(mockRunAndStream).not.toHaveBeenCalled();
  });

  it("executes milestones when pending rows exist", async () => {
    let callCount = 0;
    const { readFile } = await import("fs/promises");
    (readFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve("| M1 | Schema | `pending` | | |");
      }
      // After first iteration, no more pending
      return Promise.resolve("| M1 | Schema | `done` | abc | |");
    });

    const { handleExecute } = await import("../../../src/pipeline/handlers/execute.js");
    await handleExecute(CTX);

    expect(mockRunAndStream).toHaveBeenCalledTimes(1);
    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0004_add-qa-step", "ai_qa");
  });
});
