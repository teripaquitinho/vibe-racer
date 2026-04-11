import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import {
  validateAnswersFromString,
  hasCompletionMarker,
  removeCompletionMarker,
  countFollowUpRounds,
} from "../../src/pipeline/validation.js";

describe("validateAnswersFromString", () => {
  it("returns complete when all answers are filled", () => {
    const md = `
### Question 1
**Answer:** Yes, we should do this.

### Question 2
**Answer:** No, skip it.
`;
    const result = validateAnswersFromString(md);
    expect(result.complete).toBe(true);
    expect(result.unanswered).toEqual([]);
  });

  it("detects blank answers", () => {
    const md = `
### Question 1
**Answer:** Yes, we should do this.

### Question 2
**Answer:**

### Question 3
**Answer:**
`;
    const result = validateAnswersFromString(md);
    expect(result.complete).toBe(false);
    expect(result.unanswered).toEqual(["Question 2", "Question 3"]);
  });

  it("detects placeholder answers", () => {
    const md = `
### Question 1
**Answer:** <!-- write your answer here -->
`;
    const result = validateAnswersFromString(md);
    expect(result.complete).toBe(false);
    expect(result.unanswered).toEqual(["Question 1"]);
  });

  it("treats 'I don't care, you decide' as valid", () => {
    const md = `
### Question 1
**Answer:** I don't care, you decide.
`;
    const result = validateAnswersFromString(md);
    expect(result.complete).toBe(true);
    expect(result.unanswered).toEqual([]);
  });

  it("handles numbered bold question format", () => {
    const md = `
1. **What is the target platform?**
**Answer:** Web only.

2. **What is the deadline?**
**Answer:**
`;
    const result = validateAnswersFromString(md);
    expect(result.complete).toBe(false);
    expect(result.unanswered).toEqual(["What is the deadline?"]);
  });

  it("handles multi-line answers", () => {
    const md = `
### Question 1
**Answer:** This is a long answer
that spans multiple lines
and has lots of detail.

### Question 2
**Answer:** Short.
`;
    const result = validateAnswersFromString(md);
    expect(result.complete).toBe(true);
    expect(result.unanswered).toEqual([]);
  });

  it("handles all blank answers", () => {
    const md = `
### Q1
**Answer:**

### Q2
**Answer:**

### Q3
**Answer:**
`;
    const result = validateAnswersFromString(md);
    expect(result.complete).toBe(false);
    expect(result.unanswered).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("handles markdown with no questions", () => {
    const md = `# Just a heading\n\nSome text without questions.\n`;
    const result = validateAnswersFromString(md);
    expect(result.complete).toBe(true);
    expect(result.unanswered).toEqual([]);
  });

  it("is case-insensitive for answer marker", () => {
    const md = `
### Question 1
**answer:** Yes this works.
`;
    const result = validateAnswersFromString(md);
    expect(result.complete).toBe(true);
  });

  it("treats answer with only HTML comments as blank", () => {
    const md = `
### Question 1
**Answer:**
<!-- write your answer here -->

# Complete

- [x] Ready to advance to Product Review
`;
    const result = validateAnswersFromString(md);
    expect(result.complete).toBe(false);
    expect(result.unanswered).toEqual(["Question 1"]);
  });
});

describe("hasCompletionMarker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "jugg-val-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns true when checkbox is checked", () => {
    const file = path.join(tmpDir, "test.md");
    writeFileSync(file, "Some text\n\n# Complete\n\n- [x] Ready to advance to Product Review\n", "utf-8");
    expect(hasCompletionMarker(file)).toBe(true);
  });

  it("returns true with extra whitespace", () => {
    const file = path.join(tmpDir, "test.md");
    writeFileSync(file, "Text\n\n-  [x]  Ready to advance to Product Review\n", "utf-8");
    expect(hasCompletionMarker(file)).toBe(true);
  });

  it("returns false when checkbox is unchecked", () => {
    const file = path.join(tmpDir, "test.md");
    writeFileSync(file, "Text\n\n# Complete\n\n- [ ] Ready to advance to Product Review\n", "utf-8");
    expect(hasCompletionMarker(file)).toBe(false);
  });

  it("returns false when marker is absent", () => {
    const file = path.join(tmpDir, "test.md");
    writeFileSync(file, "Some text without marker\n", "utf-8");
    expect(hasCompletionMarker(file)).toBe(false);
  });
});

describe("removeCompletionMarker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "jugg-val-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("unchecks the checkbox", () => {
    const file = path.join(tmpDir, "test.md");
    writeFileSync(file, "Answer text\n\n# Complete\n\n- [x] Ready to advance to Product Review\n", "utf-8");
    removeCompletionMarker(file);
    const content = readFileSync(file, "utf-8");
    expect(content).toContain("- [ ] Ready to advance to Product Review");
    expect(content).not.toContain("[x]");
    expect(content).toContain("Answer text");
  });
});

describe("countFollowUpRounds", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "jugg-val-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 when file has no follow-up sections", () => {
    const file = path.join(tmpDir, "questions.md");
    writeFileSync(file, "# Questions\n\n### Q1: Something\n\n**Answer:** Yes\n", "utf-8");
    expect(countFollowUpRounds(file)).toBe(0);
  });

  it("returns 1 for file with one bare ## Follow-up Questions section", () => {
    const file = path.join(tmpDir, "questions.md");
    writeFileSync(file, "# Questions\n\n### Q1: Something\n\n**Answer:** Yes\n\n## Follow-up Questions\n\n### Q2: More\n\n**Answer:** No\n", "utf-8");
    expect(countFollowUpRounds(file)).toBe(1);
  });

  it("returns 2 for file with two follow-up sections (new format)", () => {
    const file = path.join(tmpDir, "questions.md");
    writeFileSync(file, [
      "# Questions",
      "",
      "### Q1: A",
      "**Answer:** Yes",
      "",
      "## Follow-up Questions (Round 2 of 3)",
      "",
      "### Q2: B",
      "**Answer:** No",
      "",
      "## Follow-up Questions (Round 3 of 3)",
      "",
      "### Q3: C",
      "**Answer:** Maybe",
    ].join("\n"), "utf-8");
    expect(countFollowUpRounds(file)).toBe(2);
  });

  it("returns 0 for file with unrelated ## headings", () => {
    const file = path.join(tmpDir, "questions.md");
    writeFileSync(file, "# Questions\n\n## Scope\n\nSome text\n\n## Architecture\n\nMore text\n", "utf-8");
    expect(countFollowUpRounds(file)).toBe(0);
  });

  it("returns 0 for legacy fixture with 13 questions and no follow-ups", () => {
    const file = path.join(tmpDir, "questions.md");
    const questions = Array.from({ length: 13 }, (_, i) =>
      `### Q${i + 1}: Question ${i + 1}\n\n**Answer:** Answer ${i + 1}\n`,
    ).join("\n");
    writeFileSync(file, `# Product Questions\n\n## Scope\n\n${questions}`, "utf-8");
    expect(countFollowUpRounds(file)).toBe(0);
  });
});
