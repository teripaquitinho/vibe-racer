import { execSync } from "child_process";

function assertCommand(command: string, errorMessage: string): void {
  try {
    execSync(command, { stdio: "pipe" });
  } catch {
    throw new Error(errorMessage);
  }
}

export function checkClaudeCli(): void {
  assertCommand(
    "claude --version",
    "Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code",
  );
}

export async function checkPrerequisites(): Promise<void> {
  assertCommand(
    "git --version",
    "git is required. Install from https://git-scm.com",
  );

  if (!process.env.ANTHROPIC_API_KEY) {
    // Check if Claude CLI is authenticated as fallback
    try {
      execSync("claude --version", { stdio: "pipe" });
    } catch {
      throw new Error(
        "No Claude auth found. Set ANTHROPIC_API_KEY or run `claude login`.",
      );
    }
  }
}
