import { describe, it, expect } from "vitest";
import { slugify, taskBranchName, taskPlanFolder } from "../../src/git/slug.js";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Fix bug #42: crash on login!")).toBe("fix-bug-42-crash-on-login");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("foo---bar")).toBe("foo-bar");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("-hello-")).toBe("hello");
  });

  it("truncates to maxLength", () => {
    const long = "a very long title that exceeds the default fifty character limit by a lot";
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it("does not end with a hyphen after truncation", () => {
    const result = slugify("abcdefghij klmnop", 11);
    expect(result).not.toMatch(/-$/);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("accepts custom maxLength", () => {
    expect(slugify("hello world", 5)).toBe("hello");
  });
});

describe("taskBranchName", () => {
  it("returns vibe-racer/ prefix with zero-padded number and slug", () => {
    expect(taskBranchName(42, "Add login page")).toBe(
      "vibe-racer/0042_add-login-page",
    );
  });

  it("pads single-digit numbers to 4 digits", () => {
    expect(taskBranchName(1, "fix")).toBe("vibe-racer/0001_fix");
  });

  it("handles large task numbers", () => {
    expect(taskBranchName(12345, "big")).toBe("vibe-racer/12345_big");
  });
});

describe("taskPlanFolder", () => {
  it("returns path under plans dir with zero-padded number and slug", () => {
    expect(taskPlanFolder("plans", 7, "Setup CI")).toBe(
      "plans/0007_setup-ci",
    );
  });

  it("works with custom plans directory", () => {
    expect(taskPlanFolder("docs/plans", 99, "My Feature")).toBe(
      "docs/plans/0099_my-feature",
    );
  });
});
