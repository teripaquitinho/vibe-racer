import { describe, it, expect, vi } from "vitest";
import {
  checkoutBranch,
  commitAll,
  getCurrentBranch,
  branchExists,
  getVibeRacerBranches,
  getRemoteUrl,
} from "../../src/git/operations.js";
import type { SimpleGit } from "simple-git";

function mockGit(overrides: Partial<SimpleGit> = {}): SimpleGit {
  return {
    branchLocal: vi.fn().mockResolvedValue({
      current: "main",
      all: ["main", "vibe-racer/0001_foo", "vibe-racer/0002_bar", "feature/x"],
    }),
    checkout: vi.fn().mockResolvedValue(undefined),
    checkoutLocalBranch: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ commit: "abc1234" }),
    status: vi.fn().mockResolvedValue({
      staged: ["file.ts"],
      created: [],
      deleted: [],
      renamed: [],
      modified: [],
      files: [{ path: "file.ts", index: "M", working_dir: " " }],
    }),
    getRemotes: vi.fn().mockResolvedValue([
      { name: "origin", refs: { fetch: "https://github.com/user/repo.git", push: "https://github.com/user/repo.git" } },
    ]),
    ...overrides,
  } as unknown as SimpleGit;
}

describe("checkoutBranch", () => {
  it("checks out existing branch", async () => {
    const git = mockGit();
    await checkoutBranch(git, "main");
    expect(git.checkout).toHaveBeenCalledWith("main");
    expect(git.checkoutLocalBranch).not.toHaveBeenCalled();
  });

  it("creates new branch if it does not exist", async () => {
    const git = mockGit();
    await checkoutBranch(git, "new-branch");
    expect(git.checkoutLocalBranch).toHaveBeenCalledWith("new-branch");
    expect(git.checkout).not.toHaveBeenCalled();
  });
});

describe("commitAll", () => {
  it("stages all files and commits with message", async () => {
    const git = mockGit();
    const hash = await commitAll(git, "feat: add stuff");
    expect(git.add).toHaveBeenCalledWith(".");
    expect(git.commit).toHaveBeenCalledWith("feat: add stuff");
    expect(hash).toBe("abc1234");
  });

  it("returns empty string when nothing to commit", async () => {
    const git = mockGit({
      status: vi.fn().mockResolvedValue({
        staged: [],
        created: [],
        deleted: [],
        renamed: [],
        modified: [],
        files: [],
      }),
    } as Partial<SimpleGit>);
    const hash = await commitAll(git, "should not commit");
    expect(hash).toBe("");
    expect(git.commit).not.toHaveBeenCalled();
  });

  it("commits normally when there are staged changes", async () => {
    const git = mockGit({
      status: vi.fn().mockResolvedValue({
        staged: ["file.ts"],
        created: [],
        deleted: [],
        renamed: [],
        modified: [],
        files: [{ path: "file.ts", index: "M", working_dir: " " }],
      }),
    } as Partial<SimpleGit>);
    const hash = await commitAll(git, "feat: add file");
    expect(hash).toBe("abc1234");
    expect(git.commit).toHaveBeenCalledWith("feat: add file");
  });
});

describe("getCurrentBranch", () => {
  it("returns the current branch name", async () => {
    const git = mockGit();
    const branch = await getCurrentBranch(git);
    expect(branch).toBe("main");
  });
});

describe("branchExists", () => {
  it("returns true for existing branch", async () => {
    const git = mockGit();
    expect(await branchExists(git, "main")).toBe(true);
  });

  it("returns false for non-existing branch", async () => {
    const git = mockGit();
    expect(await branchExists(git, "nope")).toBe(false);
  });
});

describe("getVibeRacerBranches", () => {
  it("returns only branches starting with vibe-racer/", async () => {
    const git = mockGit();
    const branches = await getVibeRacerBranches(git);
    expect(branches).toEqual(["vibe-racer/0001_foo", "vibe-racer/0002_bar"]);
  });

  it("returns empty array when no vibe-racer branches", async () => {
    const git = mockGit({
      branchLocal: vi.fn().mockResolvedValue({ current: "main", all: ["main"] }),
    } as Partial<SimpleGit>);
    const branches = await getVibeRacerBranches(git);
    expect(branches).toEqual([]);
  });
});

describe("getRemoteUrl", () => {
  it("returns fetch URL of origin remote", async () => {
    const git = mockGit();
    const url = await getRemoteUrl(git);
    expect(url).toBe("https://github.com/user/repo.git");
  });

  it("returns null when no origin remote", async () => {
    const git = mockGit({
      getRemotes: vi.fn().mockResolvedValue([
        { name: "upstream", refs: { fetch: "https://example.com/repo.git" } },
      ]),
    } as Partial<SimpleGit>);
    const url = await getRemoteUrl(git);
    expect(url).toBeNull();
  });

  it("returns null on error", async () => {
    const git = mockGit({
      getRemotes: vi.fn().mockRejectedValue(new Error("fail")),
    } as Partial<SimpleGit>);
    const url = await getRemoteUrl(git);
    expect(url).toBeNull();
  });
});
