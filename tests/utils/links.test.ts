import { describe, it, expect } from "vitest";
import { buildShareLink } from "../../src/utils/links.js";

describe("buildShareLink", () => {
  it("builds GitHub edit URL from HTTPS repo URL", () => {
    const url = buildShareLink(
      "https://github.com/owner/repo",
      "vibe-racer/0001_test",
      "plans/0001_test/01_product_questions.md",
    );
    expect(url).toBe(
      "https://github.com/owner/repo/edit/vibe-racer/0001_test/plans/0001_test/01_product_questions.md",
    );
  });

  it("builds URL from SSH repo URL", () => {
    const url = buildShareLink(
      "git@github.com:owner/repo.git",
      "main",
      "README.md",
    );
    expect(url).toBe("https://github.com/owner/repo/edit/main/README.md");
  });

  it("returns empty string for non-GitHub URLs", () => {
    const url = buildShareLink("https://gitlab.com/owner/repo", "main", "file.md");
    expect(url).toBe("");
  });
});
