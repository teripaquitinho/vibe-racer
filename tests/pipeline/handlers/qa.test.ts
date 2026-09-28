import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskContext } from "../../../src/pipeline/types.js";

const mockRunAndStream = vi.fn().mockResolvedValue(undefined);
const mockCommitAll = vi.fn().mockResolvedValue("qa123");
const mockUpdateStage = vi.fn();
const mockExistsSync = vi.fn();
const mockEnsureCompletionSection = vi.fn().mockReturnValue(true);
const mockQaPrompt = vi.fn().mockReturnValue({ prompt: "qa test prompt", persona: "qa test persona" });
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockWarn = vi.fn();

vi.mock("../../../src/claude/session.js", () => ({
  runAndStream: (...args: unknown[]) => mockRunAndStream(...args),
}));

vi.mock("../../../src/claude/prompts.js", () => ({
  qaPrompt: (...args: unknown[]) => mockQaPrompt(...args),
}));

vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
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
    warn: (...args: unknown[]) => mockWarn(...args),
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

const PLAYBOOK_WITH_GATES = [
  "# Execution Playbook",
  "",
  "## Execution Status",
  "",
  "| Milestone | Name | Owner | Status | Commit | Notes |",
  "|---|---|---|---|---|---|",
  "| M1 | Table contract | `agent` | `done` | a1b2c3d | — |",
  "| G1 | PRs merged into main | `operator` | `done` | — | — |",
  "| M2 | Wire the parser | `agent` | `done` | e4f5a6b | — |",
  "| G2 | Storybook check | `operator` | `done` | — | — |",
  "| M3 | Ship | `agent` | `done` | — | — |",
  "",
].join("\n");

const PLAYBOOK_NO_OWNER = [
  "## Execution Status",
  "",
  "| Milestone | Name | Status | Commit | Notes |",
  "|---|---|---|---|---|",
  "| M1 | Only milestone | `done` | — | — |",
  "",
].join("\n");

describe("handleQa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` keeps implementations but a prior test may have overridden them.
    mockQaPrompt.mockReturnValue({ prompt: "qa test prompt", persona: "qa test persona" });
    mockReadFile.mockResolvedValue(PLAYBOOK_NO_OWNER);
    mockRunAndStream.mockResolvedValue(undefined);
  });

  it("AC19 — passes the operator gates from 04_execute.md to qaPrompt as `G<n> — <name>`", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(PLAYBOOK_WITH_GATES);

    const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
    await handleQa(CTX);

    expect(mockReadFile).toHaveBeenCalledWith(
      "/tmp/repo/plans/0004_add-qa-step/04_execute.md",
      "utf-8",
    );
    expect(mockQaPrompt).toHaveBeenCalledWith(CTX, [
      "G1 — PRs merged into main",
      "G2 — Storybook check",
    ]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("passes an empty gate list for a playbook with no Owner column", async () => {
    mockExistsSync.mockReturnValue(true);

    const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
    await handleQa(CTX);

    expect(mockQaPrompt).toHaveBeenCalledWith(CTX, []);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("a malformed table yields [] plus a warning and does not throw", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue("# Playbook\n\nNo status table anywhere in this file.\n");

    const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
    await expect(handleQa(CTX)).resolves.toBeUndefined();

    expect(mockQaPrompt).toHaveBeenCalledWith(CTX, []);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0][0]).toContain("plans/0004_add-qa-step/04_execute.md");
    expect(mockWarn.mock.calls[0][0]).toContain("Execution Status");
    // The lap still ran and still advanced.
    expect(mockRunAndStream).toHaveBeenCalledTimes(1);
    expect(mockUpdateStage).toHaveBeenCalledWith("plans/0004_add-qa-step", "fine_tuning");
  });

  it("a missing playbook is treated the same way — [] plus a warning", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

    const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
    await expect(handleQa(CTX)).resolves.toBeUndefined();

    expect(mockQaPrompt).toHaveBeenCalledWith(CTX, []);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0][0]).toContain("ENOENT");
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

  describe("turn limit", () => {
    const TURN_LIMIT = new Error(
      "Claude Code returned an error result: Reached maximum number of turns (100)",
    );

    it("passes a default maxTurns of 100", async () => {
      mockExistsSync.mockReturnValue(true);

      const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
      await handleQa(CTX);

      expect(mockRunAndStream).toHaveBeenCalledWith(expect.objectContaining({ maxTurns: 100 }));
    });

    it("keeps a partial 05_qa.md, flags it incomplete, and advances", async () => {
      mockExistsSync.mockReturnValue(true);
      mockRunAndStream.mockRejectedValue(TURN_LIMIT);
      mockReadFile.mockImplementation(async (p: string) =>
        p.endsWith("05_qa.md") ? "# QA\n\n## What works\n" : PLAYBOOK_NO_OWNER,
      );

      const { handleQa, INCOMPLETE_BANNER } = await import("../../../src/pipeline/handlers/qa.js");
      await expect(handleQa(CTX)).resolves.toBeUndefined();

      expect(mockWriteFile).toHaveBeenCalledWith(
        "/tmp/repo/plans/0004_add-qa-step/05_qa.md",
        `${INCOMPLETE_BANNER}\n\n# QA\n\n## What works\n`,
      );
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("turn limit"));
      expect(mockUpdateStage).toHaveBeenCalledWith("plans/0004_add-qa-step", "fine_tuning");
    });

    it("still fails when the limit is hit before 05_qa.md exists", async () => {
      mockExistsSync.mockReturnValue(false);
      mockRunAndStream.mockRejectedValue(TURN_LIMIT);

      const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
      await expect(handleQa(CTX)).rejects.toThrow("maximum number of turns");

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockUpdateStage).not.toHaveBeenCalled();
    });

    it("rethrows any other session error even when 05_qa.md exists", async () => {
      mockExistsSync.mockReturnValue(true);
      mockRunAndStream.mockRejectedValue(new Error("network down"));

      const { handleQa } = await import("../../../src/pipeline/handlers/qa.js");
      await expect(handleQa(CTX)).rejects.toThrow("network down");

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockUpdateStage).not.toHaveBeenCalled();
    });
  });
});
