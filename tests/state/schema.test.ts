import { describe, it, expect } from "vitest";
import { stateSchema, STAGES } from "../../src/state/schema.js";

describe("stateSchema", () => {
  it("parses valid state with required fields only", () => {
    const result = stateSchema.parse({
      stage: "need_objective",
      title: "Test task",
    });
    expect(result.stage).toBe("need_objective");
    expect(result.title).toBe("Test task");
  });

  it("parses valid state with all fields", () => {
    const result = stateSchema.parse({
      stage: "error",
      title: "Test task",
      created: "2026-02-28T10:00:00Z",
      updated: "2026-02-28T14:00:00Z",
      error_message: "session failed",
      error_stage: "ai_product_review",
    });
    expect(result.error_message).toBe("session failed");
    expect(result.error_stage).toBe("ai_product_review");
  });

  it("rejects missing stage", () => {
    expect(() => stateSchema.parse({ title: "Test" })).toThrow();
  });

  it("rejects missing title", () => {
    expect(() => stateSchema.parse({ stage: "need_objective" })).toThrow();
  });

  it("rejects invalid stage value", () => {
    expect(() =>
      stateSchema.parse({ stage: "invalid_stage", title: "Test" }),
    ).toThrow();
  });

  it("accepts all valid stage values", () => {
    for (const stage of STAGES) {
      const result = stateSchema.parse({ stage, title: "Test" });
      expect(result.stage).toBe(stage);
    }
  });

  it("optional fields default to undefined", () => {
    const result = stateSchema.parse({
      stage: "need_product",
      title: "Test",
    });
    expect(result.created).toBeUndefined();
    expect(result.updated).toBeUndefined();
    expect(result.error_message).toBeUndefined();
    expect(result.error_stage).toBeUndefined();
  });

  it("accepts trivial: true", () => {
    const result = stateSchema.parse({
      stage: "need_objective",
      title: "Test",
      trivial: true,
    });
    expect(result.trivial).toBe(true);
  });

  it("accepts trivial: false", () => {
    const result = stateSchema.parse({
      stage: "need_objective",
      title: "Test",
      trivial: false,
    });
    expect(result.trivial).toBe(false);
  });

  it("accepts missing trivial field", () => {
    const result = stateSchema.parse({
      stage: "need_objective",
      title: "Test",
    });
    expect(result.trivial).toBeUndefined();
  });

  it("rejects non-boolean trivial value", () => {
    expect(() =>
      stateSchema.parse({ stage: "need_objective", title: "Test", trivial: "yes" }),
    ).toThrow();
  });

  it("accepts prev and next as valid stage values", () => {
    const result = stateSchema.parse({
      stage: "need_product",
      title: "Test",
      prev: "need_objective",
      next: "ai_objective_review",
    });
    expect(result.prev).toBe("need_objective");
    expect(result.next).toBe("ai_objective_review");
  });

  it("accepts prev and next as null", () => {
    const result = stateSchema.parse({
      stage: "need_objective",
      title: "Test",
      prev: null,
      next: null,
    });
    expect(result.prev).toBeNull();
    expect(result.next).toBeNull();
  });

  it("accepts missing prev and next (backward compat)", () => {
    const result = stateSchema.parse({
      stage: "need_objective",
      title: "Test",
    });
    expect(result.prev).toBeUndefined();
    expect(result.next).toBeUndefined();
  });

  it("rejects invalid prev value", () => {
    expect(() =>
      stateSchema.parse({ stage: "need_objective", title: "Test", prev: "bogus" }),
    ).toThrow();
  });
});
