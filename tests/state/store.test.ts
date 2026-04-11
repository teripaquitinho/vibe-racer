import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { stringify } from "yaml";
import { readState, writeState, updateStage, setError } from "../../src/state/store.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "jugg-store-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmpState(data: Record<string, unknown>): void {
  writeFileSync(path.join(tmpDir, "state.yml"), stringify(data), "utf-8");
}

describe("readState", () => {
  it("reads valid state.yml", () => {
    writeTmpState({ stage: "need_objective", title: "Test task" });
    const state = readState(tmpDir);
    expect(state.stage).toBe("need_objective");
    expect(state.title).toBe("Test task");
  });

  it("throws on invalid state.yml", () => {
    writeTmpState({ stage: "bogus", title: "Test" });
    expect(() => readState(tmpDir)).toThrow();
  });

  it("throws on missing file", () => {
    expect(() => readState(path.join(tmpDir, "nonexistent"))).toThrow();
  });
});

describe("writeState", () => {
  it("creates state.yml with updated timestamp", () => {
    const before = new Date().toISOString();
    writeState(tmpDir, { stage: "need_product", title: "Test" });
    const state = readState(tmpDir);
    expect(state.stage).toBe("need_product");
    expect(state.updated).toBeDefined();
    expect(state.updated! >= before).toBe(true);
  });
});

describe("updateStage", () => {
  it("changes stage and preserves title", () => {
    writeTmpState({ stage: "need_objective", title: "My task" });
    updateStage(tmpDir, "ai_objective_review");
    const state = readState(tmpDir);
    expect(state.stage).toBe("ai_objective_review");
    expect(state.title).toBe("My task");
    expect(state.updated).toBeDefined();
  });
});

describe("setError", () => {
  it("sets error fields correctly", () => {
    writeTmpState({ stage: "ai_product_review", title: "My task" });
    setError(tmpDir, "ai_product_review", "context window exceeded");
    const state = readState(tmpDir);
    expect(state.stage).toBe("error");
    expect(state.error_stage).toBe("ai_product_review");
    expect(state.error_message).toBe("context window exceeded");
    expect(state.title).toBe("My task");
  });
});

describe("writeState prev/next computation", () => {
  it("computes prev and next from stage", () => {
    writeState(tmpDir, { stage: "need_product", title: "Test" });
    const state = readState(tmpDir);
    expect(state.prev).toBe("ai_objective_review");
    expect(state.next).toBe("ai_product_review");
  });

  it("sets prev=null for need_objective", () => {
    writeState(tmpDir, { stage: "need_objective", title: "Test" });
    const state = readState(tmpDir);
    expect(state.prev).toBeNull();
    expect(state.next).toBe("ai_objective_review");
  });

  it("sets next=null for done", () => {
    writeState(tmpDir, { stage: "done", title: "Test" });
    const state = readState(tmpDir);
    expect(state.prev).toBe("cleanup_ready");
    expect(state.next).toBeNull();
  });

  it("handles error stage with valid error_stage", () => {
    writeState(tmpDir, {
      stage: "error",
      title: "Test",
      error_stage: "ai_product_review",
      error_message: "failed",
    });
    const state = readState(tmpDir);
    expect(state.prev).toBe("ai_product_review");
    expect(state.next).toBeNull();
  });

  it("handles error stage with non-Stage error_stage", () => {
    writeState(tmpDir, {
      stage: "error",
      title: "Test",
      error_stage: "some-handler",
      error_message: "failed",
    });
    const state = readState(tmpDir);
    expect(state.prev).toBeNull();
    expect(state.next).toBeNull();
  });
});

describe("updateStage prev/next", () => {
  it("computes prev/next correctly", () => {
    writeTmpState({ stage: "need_objective", title: "My task" });
    updateStage(tmpDir, "ai_design_review");
    const state = readState(tmpDir);
    expect(state.stage).toBe("ai_design_review");
    expect(state.prev).toBe("need_design");
    expect(state.next).toBe("need_plan");
  });
});
