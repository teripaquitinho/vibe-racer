import { resolve } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { scanFiles, type SecretMatch } from "./secrets.js";

export function createGit(cwd: string): SimpleGit {
  return simpleGit(cwd);
}

export async function checkoutBranch(
  git: SimpleGit,
  branchName: string,
): Promise<void> {
  const branches = await git.branchLocal();
  if (branches.all.includes(branchName)) {
    await git.checkout(branchName);
  } else {
    await git.checkoutLocalBranch(branchName);
  }
}

export class SecretDetectedError extends Error {
  constructor(public readonly matches: SecretMatch[]) {
    const files = matches.map((m) => `  ${m.file}: ${m.reason}`).join("\n");
    super(`Secret scan blocked commit. Flagged files:\n${files}`);
    this.name = "SecretDetectedError";
  }
}

export async function commitAll(
  git: SimpleGit,
  message: string,
  cwd?: string,
): Promise<string> {
  await git.add(".");

  // Pre-commit secret scan on staged files
  if (cwd) {
    const status = await git.status();
    const stagedFiles = [
      ...status.created,
      ...status.staged,
      ...status.modified.filter((f) => status.staged.includes(f)),
    ];
    // Deduplicate and resolve to absolute paths
    const unique = [...new Set(stagedFiles)];
    const absolutePaths = unique.map((f) => resolve(cwd, f));
    const hits = scanFiles(absolutePaths);
    if (hits.length > 0) {
      // Unstage flagged files before throwing
      for (const hit of hits) {
        await git.reset([hit.file]);
      }
      throw new SecretDetectedError(hits);
    }
  }

  // Skip commit if nothing is staged
  const finalStatus = await git.status();
  if (
    finalStatus.staged.length === 0 &&
    finalStatus.created.length === 0 &&
    finalStatus.deleted.length === 0 &&
    finalStatus.renamed.length === 0
  ) {
    return "";
  }

  const result = await git.commit(message);
  return result.commit;
}

export async function getVibeRacerBranches(
  git: SimpleGit,
): Promise<string[]> {
  const branches = await git.branchLocal();
  return branches.all.filter((b) => b.startsWith("vibe-racer/"));
}

/**
 * The checked-out branch, or `""` on a detached HEAD or a repo with no branches yet.
 *
 * Its only caller is `drive`'s nothing-to-do hint, which runs after every other decision has
 * been made — a throw there would turn a cosmetic line into a failed command, so it never throws.
 */
export async function currentBranch(git: SimpleGit): Promise<string> {
  try {
    const branches = await git.branchLocal();
    return branches.current ?? "";
  } catch {
    return "";
  }
}

export interface RepoSnapshot {
  /** `""` when there is no commit yet — an unborn branch is not an error here. */
  head: string;
  /** Every path git considers untracked, changed or staged. Sorted, de-duplicated. */
  dirtyFiles: string[];
}

/**
 * What the repository looks like right now — the two halves of "did anything happen".
 *
 * `ignorePrefix` drops paths under one directory, which the execute loop sets to the task's
 * plan dir: the agent flipping its own status cell must not read as work done on the codebase.
 */
export async function repoSnapshot(
  git: SimpleGit,
  ignorePrefix?: string,
): Promise<RepoSnapshot> {
  let head = "";
  try {
    head = (await git.revparse(["HEAD"])).trim();
  } catch {
    head = "";
  }

  const status = await git.status();
  const paths = [
    ...status.not_added,
    ...status.created,
    ...status.modified,
    ...status.deleted,
    ...status.renamed.map((r) => r.to),
    ...status.staged,
  ];

  const kept = paths.filter(
    (p) => typeof p === "string" && p !== "" && !(ignorePrefix && p.startsWith(ignorePrefix)),
  );
  return { head, dirtyFiles: [...new Set(kept)].sort() };
}

export async function getRemoteUrl(git: SimpleGit): Promise<string | null> {
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    return origin?.refs.fetch ?? null;
  } catch {
    return null;
  }
}
