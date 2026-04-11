import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
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

import { selectTask, type SelectTaskOptions } from "../../src/cli/task-select.js";
import type { Task } from "../../src/state/discovery.js";
import { log } from "../../src/utils/logger.js";
import { select } from "@inquirer/prompts";

function makeTask(overrides: Partial<Task> & { number: number; stage: Task["stage"] }): Task {
  return {
    slug: `task-${overrides.number}`,
    title: `Task ${overrides.number}`,
    planPath: `/tmp/plans/000${overrides.number}_task-${overrides.number}`,
    ...overrides,
  };
}

describe("selectTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the only matching task when filter matches exactly one", async () => {
    const tasks = [
      makeTask({ number: 1, stage: "need_objective" }),
      makeTask({ number: 2, stage: "ai_objective_review" }),
    ];

    const result = await selectTask({
      tasks,
      filter: (stage) => stage === "need_objective",
      noMatchMessage: "No match.",
    });

    expect(result).toEqual(tasks[0]);
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("#1"),
    );
  });

  it("returns null and prints noMatchMessage when no tasks match filter", async () => {
    const tasks = [
      makeTask({ number: 1, stage: "ai_objective_review" }),
    ];

    const result = await selectTask({
      tasks,
      filter: (stage) => stage === "need_objective",
      noMatchMessage: "No tasks at a review stage right now.",
    });

    expect(result).toBeNull();
    expect(log.dim).toHaveBeenCalledWith("No tasks at a review stage right now.");
  });

  it("returns the task when taskNumber exists and passes filter", async () => {
    const tasks = [
      makeTask({ number: 1, stage: "need_objective" }),
      makeTask({ number: 2, stage: "need_product" }),
    ];

    const result = await selectTask({
      tasks,
      filter: (stage) => stage === "need_product",
      taskNumber: 2,
      noMatchMessage: "No match.",
    });

    expect(result).toEqual(tasks[1]);
  });

  it("returns null and prints not-found when task doesn't exist", async () => {
    const tasks = [
      makeTask({ number: 1, stage: "need_objective" }),
    ];

    const result = await selectTask({
      tasks,
      filter: () => true,
      taskNumber: 99,
      noMatchMessage: "No match.",
    });

    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith("Task #99 not found.");
  });

  it("returns null and prints ineligible message when task exists but fails filter", async () => {
    const tasks = [
      makeTask({ number: 1, stage: "ai_objective_review" }),
    ];

    const result = await selectTask({
      tasks,
      filter: (stage) => stage === "need_objective",
      taskNumber: 1,
      noMatchMessage: "No match.",
      ineligibleMessage: (task) =>
        `Task #${task.number} is at [${task.stage}] — nothing to review right now.`,
    });

    expect(result).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      "Task #1 is at [ai_objective_review] — nothing to review right now.",
    );
  });

  it("shows select menu when multiple tasks match", async () => {
    const tasks = [
      makeTask({ number: 1, stage: "need_objective" }),
      makeTask({ number: 2, stage: "need_product" }),
      makeTask({ number: 3, stage: "ai_objective_review" }),
    ];

    vi.mocked(select).mockResolvedValue(2);

    const result = await selectTask({
      tasks,
      filter: (stage) => stage === "need_objective" || stage === "need_product",
      noMatchMessage: "No match.",
    });

    expect(result).toEqual(tasks[1]);
    expect(select).toHaveBeenCalledWith({
      message: "Which task to process?",
      choices: [
        { name: "#1 Task 1 [need_objective]", value: 1 },
        { name: "#2 Task 2 [need_product]", value: 2 },
      ],
    });
  });
});
