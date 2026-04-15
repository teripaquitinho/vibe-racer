import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "fs";
import path from "path";
import os from "os";
import { parse } from "yaml";
import { createPlanFolder } from "../../src/state/plan-folder.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "jugg-plan-folder-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createPlanFolder", () => {
  it("creates folder with correct NNNN_slug name", () => {
    const result = createPlanFolder({
      title: "Test task",
      plansDir: tmpDir,
      slug: "test-task",
      checkboxLabel: "Objective Review",
    });

    expect(result.folderName).toBe("0001_test-task");
    expect(existsSync(result.planDir)).toBe(true);
  });

  it("writes 00_objective.md with default body when no objectiveContent provided", () => {
    const { planDir } = createPlanFolder({
      title: "Test task",
      plansDir: tmpDir,
      slug: "test-task",
      checkboxLabel: "Objective Review",
    });

    const content = readFileSync(path.join(planDir, "00_objective.md"), "utf-8");
    expect(content).toContain("> Write your objective here.");
  });

  it("writes 00_objective.md with custom content when objectiveContent provided", () => {
    const { planDir } = createPlanFolder({
      title: "Test task",
      plansDir: tmpDir,
      slug: "test-task",
      objectiveContent: "Custom objective content here.",
      checkboxLabel: "Objective Review",
    });

    const content = readFileSync(path.join(planDir, "00_objective.md"), "utf-8");
    expect(content).toContain("Custom objective content here.");
    expect(content).not.toContain("> Write your objective here.");
  });

  it("writes unchecked checkbox when checked is false", () => {
    const { planDir } = createPlanFolder({
      title: "Test task",
      plansDir: tmpDir,
      slug: "test-task",
      checkboxLabel: "Objective Review",
      checked: false,
    });

    const content = readFileSync(path.join(planDir, "00_objective.md"), "utf-8");
    expect(content).toContain("- [ ] Ready to advance to Objective Review");
  });

  it("writes unchecked checkbox when checked is undefined", () => {
    const { planDir } = createPlanFolder({
      title: "Test task",
      plansDir: tmpDir,
      slug: "test-task",
      checkboxLabel: "Objective Review",
    });

    const content = readFileSync(path.join(planDir, "00_objective.md"), "utf-8");
    expect(content).toContain("- [ ] Ready to advance to Objective Review");
  });

  it("writes checked checkbox when checked is true", () => {
    const { planDir } = createPlanFolder({
      title: "Test task",
      plansDir: tmpDir,
      slug: "test-task",
      checkboxLabel: "Objective Review",
      checked: true,
    });

    const content = readFileSync(path.join(planDir, "00_objective.md"), "utf-8");
    expect(content).toContain("- [x] Ready to advance to Objective Review");
  });

  it("writes state.yml with correct initial stage, title, and timestamps", () => {
    const before = new Date().toISOString();
    const { planDir } = createPlanFolder({
      title: "My task",
      plansDir: tmpDir,
      slug: "my-task",
      checkboxLabel: "Objective Review",
    });

    const raw = parse(readFileSync(path.join(planDir, "state.yml"), "utf-8"));
    expect(raw.stage).toBe("need_objective");
    expect(raw.title).toBe("My task");
    expect(raw.created).toBeDefined();
    expect(raw.created >= before).toBe(true);
  });

  it("writes state.yml with trivial: true when option set", () => {
    const { planDir } = createPlanFolder({
      title: "Trivial task",
      plansDir: tmpDir,
      slug: "trivial-task",
      trivial: true,
      checkboxLabel: "Plan Questions",
    });

    const raw = parse(readFileSync(path.join(planDir, "state.yml"), "utf-8"));
    expect(raw.trivial).toBe(true);
  });

  it("does not include trivial key in state.yml when option is undefined", () => {
    const { planDir } = createPlanFolder({
      title: "Normal task",
      plansDir: tmpDir,
      slug: "normal-task",
      checkboxLabel: "Objective Review",
    });

    const raw = parse(readFileSync(path.join(planDir, "state.yml"), "utf-8"));
    expect("trivial" in raw).toBe(false);
  });

  it("returns correct taskNumber, folderName, planDir", () => {
    const result = createPlanFolder({
      title: "Test task",
      plansDir: tmpDir,
      slug: "test-task",
      checkboxLabel: "Objective Review",
    });

    expect(result.taskNumber).toBe(1);
    expect(result.folderName).toBe("0001_test-task");
    expect(result.planDir).toBe(path.join(tmpDir, "0001_test-task"));
  });

  it("increments task number for subsequent calls", () => {
    createPlanFolder({
      title: "First",
      plansDir: tmpDir,
      slug: "first",
      checkboxLabel: "Objective Review",
    });

    const result = createPlanFolder({
      title: "Second",
      plansDir: tmpDir,
      slug: "second",
      checkboxLabel: "Objective Review",
    });

    expect(result.taskNumber).toBe(2);
    expect(result.folderName).toBe("0002_second");
  });
});
