import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import path from "path";
import os from "os";
import { stringify } from "yaml";
import { tryAdvance } from "../../src/state/advancement.js";
import { readState } from "../../src/state/store.js";

let tmpDir: string;
let planDir: string;
const PLAN_REL = "plans/0001_test";

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "jugg-adv-"));
  planDir = path.join(tmpDir, PLAN_REL);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(
    path.join(planDir, "state.yml"),
    stringify({ stage: "need_product", title: "Test" }),
    "utf-8",
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("tryAdvance", () => {
  it("returns no_questions_file when file does not exist", async () => {
    const result = await tryAdvance(PLAN_REL, "need_product", tmpDir);
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("no_questions_file");
  });

  it("returns no_marker when file exists but has no marker", async () => {
    writeFileSync(
      path.join(planDir, "01_product_questions.md"),
      "### Q1: Test\n\n**Answer:**\nYes.\n",
      "utf-8",
    );
    const result = await tryAdvance(PLAN_REL, "need_product", tmpDir);
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("no_marker");
  });

  it("returns incomplete_answers and unchecks marker when answers are blank", async () => {
    writeFileSync(
      path.join(planDir, "01_product_questions.md"),
      "### Q1: Test\n\n**Answer:**\n<!-- write your answer here -->\n\n# Complete\n\n- [x] Ready to advance to Product Review\n",
      "utf-8",
    );
    const result = await tryAdvance(PLAN_REL, "need_product", tmpDir);
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("incomplete_answers");
    // Marker should be unchecked
    const content = readFileSync(
      path.join(planDir, "01_product_questions.md"),
      "utf-8",
    );
    expect(content).toContain("- [ ] Ready to advance to Product Review");
    expect(content).not.toContain("[x]");
  });

  it("advances state when marker present and answers complete", async () => {
    writeFileSync(
      path.join(planDir, "01_product_questions.md"),
      "### Q1: Test\n\n**Answer:**\nYes, this is complete.\n\n# Complete\n\n- [x] Ready to advance to Product Review\n",
      "utf-8",
    );
    const result = await tryAdvance(PLAN_REL, "need_product", tmpDir);
    expect(result.advanced).toBe(true);
    expect(result.reason).toBe("advanced");
    const state = readState(planDir);
    expect(state.stage).toBe("ai_product_review");
  });

  it("returns no_questions_file for stages without mapping", async () => {
    const result = await tryAdvance(PLAN_REL, "ai_product_review", tmpDir);
    expect(result.advanced).toBe(false);
    expect(result.reason).toBe("no_questions_file");
  });
});
