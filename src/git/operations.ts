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

export async function getCurrentBranch(git: SimpleGit): Promise<string> {
  return (await git.branchLocal()).current;
}

export async function branchExists(
  git: SimpleGit,
  branchName: string,
): Promise<boolean> {
  const branches = await git.branchLocal();
  return branches.all.includes(branchName);
}

export async function getVibeRacerBranches(
  git: SimpleGit,
): Promise<string[]> {
  const branches = await git.branchLocal();
  return branches.all.filter((b) => b.startsWith("vibe-racer/"));
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
