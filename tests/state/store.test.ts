import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
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
    expect(state.prev).toBe("need_decision");
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

  it("survives invalid YAML in state.yml and salvages title/created/trivial", () => {
    writeFileSync(
      path.join(tmpDir, "state.yml"),
      "stage: bogus_stage\ntitle: Salvageable\ncreated: 2026-01-01\ntrivial: true\n",
      "utf-8",
    );
    setError(tmpDir, "ai_product_review", "context exceeded");
    const state = readState(tmpDir);
    expect(state.stage).toBe("error");
    expect(state.error_stage).toBe("ai_product_review");
    expect(state.error_message).toBe("context exceeded");
    expect(state.title).toBe("Salvageable");
    expect(state.created).toBe("2026-01-01");
    expect(state.trivial).toBe(true);
  });

  it("survives missing state.yml with fallback title", () => {
    // tmpDir has no state.yml at all
    const subDir = path.join(tmpDir, "0042_my-task");
    require("fs").mkdirSync(subDir, { recursive: true });
    setError(subDir, "ready_to_execute", "session crash");
    const state = readState(subDir);
    expect(state.stage).toBe("error");
    expect(state.title).toBe("0042_my-task");
    expect(state.error_stage).toBe("ready_to_execute");
  });

  it("does not throw when salvaged record would fail stateSchema.parse", () => {
    // Write YAML that salvages a `next` field with an old invalid value
    writeFileSync(
      path.join(tmpDir, "state.yml"),
      "stage: bogus\ntitle: Test\nnext: ai_plan\n",
      "utf-8",
    );
    expect(() => setError(tmpDir, "ai_plan_review", "boom")).not.toThrow();
    const state = readState(tmpDir);
    expect(state.stage).toBe("error");
  });

  it("regression: setError on state.yml with next: ai_plan writes valid error", () => {
    writeFileSync(
      path.join(tmpDir, "state.yml"),
      "stage: need_plan\ntitle: Old task\nnext: ai_plan\n",
      "utf-8",
    );
    expect(() => setError(tmpDir, "ai_plan_review", "failed")).not.toThrow();
    const state = readState(tmpDir);
    expect(state.stage).toBe("error");
    expect(state.error_stage).toBe("ai_plan_review");
    expect(state.title).toBe("Old task");
  });
});

describe("writeState — validate-on-write", () => {
  it("rejects invalid state object with Zod validation error", () => {
    writeTmpState({ stage: "need_objective", title: "Test" });
    expect(() =>
      writeState(tmpDir, { stage: "not_a_real_stage", title: "Bad" } as any),
    ).toThrow();
  });
});
