import { describe, it, expect, vi } from "vitest";
import {
  checkoutBranch,
  commitAll,
  getVibeRacerBranches,
  getRemoteUrl,
  repoSnapshot,
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

describe("repoSnapshot", () => {
  function dirtyGit(overrides: Record<string, unknown> = {}) {
    return mockGit({
      revparse: vi.fn().mockResolvedValue("deadbee\n"),
      status: vi.fn().mockResolvedValue({
        not_added: ["src/new.ts", "plans/0005_x/state.yml"],
        created: ["src/new.ts"],
        modified: ["src/a.ts"],
        deleted: ["src/gone.ts"],
        renamed: [{ from: "src/old.ts", to: "src/moved.ts" }],
        staged: ["src/a.ts", "plans/0005_x/04_execute.md"],
      }),
      ...overrides,
    } as unknown as Partial<SimpleGit>);
  }

  it("returns HEAD and the sorted, de-duplicated dirty set", async () => {
    const snapshot = await repoSnapshot(dirtyGit());
    expect(snapshot.head).toBe("deadbee");
    expect(snapshot.dirtyFiles).toEqual([
      "plans/0005_x/04_execute.md",
      "plans/0005_x/state.yml",
      "src/a.ts",
      "src/gone.ts",
      "src/moved.ts",
      "src/new.ts",
    ]);
  });

  it("drops paths under the ignored prefix", async () => {
    const snapshot = await repoSnapshot(dirtyGit(), "plans/0005_x");
    expect(snapshot.dirtyFiles).toEqual([
      "src/a.ts",
      "src/gone.ts",
      "src/moved.ts",
      "src/new.ts",
    ]);
  });

  it("reports an empty head on an unborn branch rather than throwing", async () => {
    const git = dirtyGit({
      revparse: vi.fn().mockRejectedValue(new Error("unknown revision HEAD")),
    });
    await expect(repoSnapshot(git)).resolves.toMatchObject({ head: "" });
  });
});
