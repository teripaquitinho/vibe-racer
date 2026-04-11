import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { stringify } from "yaml";
import { discoverTasks, getNextTaskNumber } from "../../src/state/discovery.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "jugg-disc-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function createTask(name: string, state: Record<string, unknown>): void {
  const dir = path.join(tmpDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "state.yml"), stringify(state), "utf-8");
}

describe("discoverTasks", () => {
  it("discovers folders with state.yml", () => {
    createTask("0001_first", { stage: "need_product", title: "First" });
    createTask("0002_second", { stage: "ai_design_review", title: "Second" });
    const tasks = discoverTasks(tmpDir);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].number).toBe(1);
    expect(tasks[0].slug).toBe("first");
    expect(tasks[0].title).toBe("First");
    expect(tasks[0].stage).toBe("need_product");
    expect(tasks[1].number).toBe(2);
  });

  it("ignores folders without state.yml", () => {
    createTask("0001_has-state", { stage: "need_objective", title: "Has" });
    mkdirSync(path.join(tmpDir, "0002_no-state"));
    const tasks = discoverTasks(tmpDir);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].number).toBe(1);
  });

  it("ignores non-matching folder names", () => {
    createTask("0001_valid", { stage: "need_objective", title: "Valid" });
    mkdirSync(path.join(tmpDir, "random-folder"));
    writeFileSync(
      path.join(tmpDir, "random-folder", "state.yml"),
      stringify({ stage: "done", title: "Random" }),
      "utf-8",
    );
    const tasks = discoverTasks(tmpDir);
    expect(tasks).toHaveLength(1);
  });

  it("sorts by number ascending", () => {
    createTask("0003_third", { stage: "done", title: "Third" });
    createTask("0001_first", { stage: "need_objective", title: "First" });
    createTask("0002_second", { stage: "need_product", title: "Second" });
    const tasks = discoverTasks(tmpDir);
    expect(tasks.map((t) => t.number)).toEqual([1, 2, 3]);
  });

  it("skips folders with invalid state.yml", () => {
    createTask("0001_valid", { stage: "need_objective", title: "Valid" });
    createTask("0002_invalid", { stage: "bogus", title: "Invalid" });
    const tasks = discoverTasks(tmpDir);
    expect(tasks).toHaveLength(1);
  });

  it("returns empty array for nonexistent directory", () => {
    const tasks = discoverTasks(path.join(tmpDir, "nope"));
    expect(tasks).toEqual([]);
  });

  it("returns trivial: true when state has trivial flag", () => {
    createTask("0001_trivial", { stage: "need_plan", title: "Trivial", trivial: true });
    const tasks = discoverTasks(tmpDir);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].trivial).toBe(true);
  });

  it("returns trivial: undefined when state has no trivial field", () => {
    createTask("0001_normal", { stage: "need_product", title: "Normal" });
    const tasks = discoverTasks(tmpDir);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].trivial).toBeUndefined();
  });
});

describe("getNextTaskNumber", () => {
  it("returns max+1", () => {
    createTask("0003_third", { stage: "done", title: "Third" });
    createTask("0001_first", { stage: "done", title: "First" });
    expect(getNextTaskNumber(tmpDir)).toBe(4);
  });

  it("returns 1 for empty directory", () => {
    expect(getNextTaskNumber(tmpDir)).toBe(1);
  });

  it("returns 1 for nonexistent directory", () => {
    expect(getNextTaskNumber(path.join(tmpDir, "nope"))).toBe(1);
  });
});
