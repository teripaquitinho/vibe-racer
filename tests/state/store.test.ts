import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { stringify } from "yaml";
import { readState, updateStage, setError } from "../../src/state/store.js";

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

describe("updateStage", () => {
  it("changes stage and preserves title", () => {
    writeTmpState({ stage: "need_objective", title: "My task" });
    updateStage(tmpDir, "ai_objective_review");
    const state = readState(tmpDir);
    expect(state.stage).toBe("ai_objective_review");
    expect(state.title).toBe("My task");
    expect(state.updated).toBeDefined();
  });

  it("creates state.yml with updated timestamp", () => {
    writeTmpState({ stage: "need_objective", title: "Test" });
    const before = new Date().toISOString();
    updateStage(tmpDir, "need_product");
    const state = readState(tmpDir);
    expect(state.stage).toBe("need_product");
    expect(state.updated).toBeDefined();
    expect(state.updated! >= before).toBe(true);
  });

  it("computes prev and next from stage", () => {
    writeTmpState({ stage: "need_objective", title: "Test" });
    updateStage(tmpDir, "need_product");
    const state = readState(tmpDir);
    expect(state.prev).toBe("ai_objective_review");
    expect(state.next).toBe("ai_product_review");
  });

  it("sets prev=null for need_objective", () => {
    writeTmpState({ stage: "need_product", title: "Test" });
    updateStage(tmpDir, "need_objective");
    const state = readState(tmpDir);
    expect(state.prev).toBeNull();
    expect(state.next).toBe("ai_objective_review");
  });

  it("sets next=null for done", () => {
    writeTmpState({ stage: "need_objective", title: "Test" });
    updateStage(tmpDir, "done");
    const state = readState(tmpDir);
    expect(state.prev).toBe("cleanup_ready");
    expect(state.next).toBeNull();
  });

  it("computes prev/next correctly for ai_design_review", () => {
    writeTmpState({ stage: "need_objective", title: "My task" });
    updateStage(tmpDir, "ai_design_review");
    const state = readState(tmpDir);
    expect(state.stage).toBe("ai_design_review");
    expect(state.prev).toBe("need_design");
    expect(state.next).toBe("need_plan");
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

  it("handles error stage with valid error_stage prev/next", () => {
    writeTmpState({ stage: "need_objective", title: "Test" });
    setError(tmpDir, "ai_product_review", "failed");
    const state = readState(tmpDir);
    expect(state.prev).toBe("ai_product_review");
    expect(state.next).toBeNull();
  });

  it("handles error stage with non-Stage error_stage", () => {
    writeTmpState({ stage: "need_objective", title: "Test" });
    setError(tmpDir, "some-handler", "failed");
    const state = readState(tmpDir);
    expect(state.prev).toBeNull();
    expect(state.next).toBeNull();
  });
});
