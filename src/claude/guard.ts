import { realpathSync } from "node:fs";
import { resolve, dirname, basename, sep } from "node:path";
import { tmpdir, homedir } from "node:os";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Stage } from "../state/schema.js";
import { log } from "../utils/logger.js";
import { appendAuditEntry } from "./audit.js";

export interface GuardOptions {
  cwd: string;
  stage: Stage;
  taskPlanPath: string;
}

const REVIEW_STAGES: Set<Stage> = new Set([
  "ai_objective_review",
  "ai_product_review",
  "ai_design_review",
  "ai_plan_review",
]);

const BASH_BLOCKLIST: string[] = [
  "curl",
  "wget",
  "nc",
  "netcat",
  "ncat",
  "socat",
  "telnet",
  "ftp",
  "sftp",
  "ssh",
  "scp",
  "rsync",
  "sudo",
  "su",
  "chmod",
  "chown",
  "dd",
  "mkfs",
];

// ─── Interpreter-aware network detection ──────────────────

/** Maps interpreter names to their inline-execution flags. */
const INTERPRETER_EXEC_FLAGS: Record<string, string[]> = {
  node: ["-e", "--eval", "-p", "--print"],
  python: ["-c"],
  python3: ["-c"],
  ruby: ["-e"],
  perl: ["-e", "-E"],
  php: ["-r"],
};

/**
 * Network-capable module/function signatures across languages.
 * These match the straightforward patterns an LLM would generate.
 * The obfuscation heuristics (eval+Buffer.from, String.fromCharCode) catch
 * the most common documented bypass techniques with minimal false positive risk.
 */
const NETWORK_SIGNATURES: RegExp[] = [
  // Node
  /require\s*\(\s*['"](?:http|https|net|dgram|dns|tls)['"]\s*\)/,
  /from\s+['"](?:http|https|net|dgram|dns|tls)['"]/,
  /\bfetch\s*\(/,
  /\bchild_process\b/,
  /\bexecSync\b/,
  /\bspawnSync\b/,

  // Python
  /\burllib\b/,
  /\brequests\./,
  /\bhttp\.client\b/,
  /\bsocket\b/,
  /\bsubprocess\b/,

  // Ruby
  /net\/http/i,
  /open-uri/,

  // Perl
  /LWP::/,
  /IO::Socket/,
  /HTTP::Tiny/,

  // PHP
  /\bfile_get_contents\s*\(\s*['"]https?:/,
  /\bcurl_init\b/,
  /\bfsockopen\b/,

  // Obfuscation heuristics — common bypass techniques
  /\beval\s*\(.*Buffer\.from\s*\(/,
  /String\.fromCharCode\s*\(/,
];

const SENSITIVE_PATHS: string[] = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".config/gcloud",
  ".netrc",
  ".env",
];

const SENSITIVE_ABSOLUTE: string[] = ["/etc/shadow", "/etc/passwd"];

const PATH_TOOLS: Set<string> = new Set([
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
]);

function resolveToolPath(inputPath: string, cwd: string): string {
  const resolved = resolve(cwd, inputPath);
  try {
    return realpathSync(resolved);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      try {
        const parentReal = realpathSync(dirname(resolved));
        return resolve(parentReal, basename(resolved));
      } catch (parentErr: unknown) {
        if (
          parentErr instanceof Error &&
          "code" in parentErr &&
          parentErr.code === "ENOENT"
        ) {
          return resolved;
        }
        throw parentErr;
      }
    }
    throw err;
  }
}

function isWithinAllowed(resolvedPath: string, cwd: string): boolean {
  const normalCwd = resolve(cwd) + sep;
  const normalTmp = resolve(tmpdir()) + sep;
  const p = resolve(resolvedPath);
  return (
    p.startsWith(normalCwd) ||
    p === resolve(cwd) ||
    p.startsWith(normalTmp) ||
    p === resolve(tmpdir())
  );
}

function isSensitivePath(resolvedPath: string): boolean {
  const home = homedir();
  for (const sensitive of SENSITIVE_PATHS) {
    const full = resolve(home, sensitive);
    if (resolvedPath === full || resolvedPath.startsWith(full + sep)) {
      return true;
    }
  }
  for (const abs of SENSITIVE_ABSOLUTE) {
    if (resolvedPath === abs || resolvedPath.startsWith(abs + sep)) {
      return true;
    }
  }
  return false;
}

function extractPath(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
    return (input.file_path as string | undefined) ?? null;
  }
  if (toolName === "Glob" || toolName === "Grep") {
    return (input.path as string | undefined) ?? null;
  }
  return null;
}

/**
 * Detects interpreter inline-execution with network-capable code.
 * Matches patterns like `node -e "require('http')..."` or `python3 -c "import urllib..."`.
 *
 * This catches the straightforward code an LLM would generate. It does NOT
 * catch obfuscation (base64, string concat, variable indirection) — see
 * docs/security.md L1 for known limitations.
 */
function checkInterpreterNetworkCall(command: string): PermissionResult {
  for (const [interpreter, flags] of Object.entries(INTERPRETER_EXEC_FLAGS)) {
    // Match: interpreter (optionally via /usr/bin/ or /usr/bin/env) followed by exec flag
    const flagAlt = flags.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const pattern = new RegExp(
      `(?:^|[;|&]\\s*)(?:/usr/bin/(?:env\\s+)?)?${interpreter}\\s+(?:${flagAlt})\\s`,
    );

    if (!pattern.test(command)) continue;

    for (const sig of NETWORK_SIGNATURES) {
      if (sig.test(command)) {
        return {
          behavior: "deny",
          message: `Interpreter network call: ${interpreter} inline code with ${sig.source}`,
        };
      }
    }
  }
  return { behavior: "allow" };
}

function checkBashCommand(command: string, cwd: string): PermissionResult {
  // Tokenize by splitting on whitespace and shell delimiters
  const tokens = command.split(/[\s;|&`]+|\$\(/);

  for (const token of tokens) {
    if (!token) continue;
    for (const blocked of BASH_BLOCKLIST) {
      if (token === blocked || token.endsWith(`/${blocked}`)) {
        return {
          behavior: "deny",
          message: `Blocked command: ${blocked}`,
        };
      }
    }
  }

  // Check for rm -rf / or rm -rf ~
  if (/\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+[/~]\s*$/.test(command)) {
    return {
      behavior: "deny",
      message: "Blocked command: destructive rm",
    };
  }

  // Check for interpreter inline code with network access
  const interpResult = checkInterpreterNetworkCall(command);
  if (interpResult.behavior === "deny") {
    return interpResult;
  }

  // Check for path references outside project
  // Match absolute paths: /something or ~/something at token boundaries
  const pathPatterns = command.matchAll(
    /(?:^|(?<=\s))(?:~\/[^\s;|&`]+|\/[^\s;|&`]+)/gm,
  );
  for (const match of pathPatterns) {
    let pathStr = match[0];
    if (pathStr.startsWith("~/")) {
      pathStr = resolve(homedir(), pathStr.slice(2));
    }
    // Check sensitive paths in command
    if (isSensitivePath(pathStr)) {
      return {
        behavior: "deny",
        message: `References sensitive path: ${match[0]}`,
      };
    }
    if (!isWithinAllowed(pathStr, cwd)) {
      return {
        behavior: "deny",
        message: `References path outside project: ${match[0]}`,
      };
    }
  }

  return { behavior: "allow" };
}

export function createToolGuard(options: GuardOptions): CanUseTool {
  const { cwd, stage, taskPlanPath } = options;

  function deny(tool: string, inputSummary: string, reason: string): PermissionResult {
    const msg = `Denied: ${tool} ${inputSummary} — ${reason}`;
    log.warn(msg);
    appendAuditEntry(cwd, {
      ts: new Date().toISOString(),
      stage,
      tool,
      input: inputSummary,
      reason,
    });
    return { behavior: "deny", message: msg };
  }

  return async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> => {
    try {
      // Handle path-bearing tools
      if (PATH_TOOLS.has(toolName)) {
        const rawPath = extractPath(toolName, input);
        if (rawPath !== null) {
          const resolved = resolveToolPath(rawPath, cwd);

          // Rule 1: Sensitive path blocklist
          if (isSensitivePath(resolved)) {
            return deny(toolName, rawPath, "sensitive path");
          }

          // Rule 2: Path containment
          if (!isWithinAllowed(resolved, cwd)) {
            return deny(toolName, rawPath, "path outside project directory");
          }

          // Rule 3: Dotenv / secrets file protection
          const base = basename(resolved);
          if (/^\.env(\..+)?$/.test(base)) {
            return deny(toolName, rawPath, "file may contain secrets");
          }

          // Rule 4: Review-stage Write/Edit restriction
          if ((toolName === "Write" || toolName === "Edit") && REVIEW_STAGES.has(stage)) {
            const planDir = resolve(cwd, taskPlanPath) + sep;
            if (!resolved.startsWith(planDir) && resolved !== resolve(cwd, taskPlanPath)) {
              return deny(toolName, rawPath, `review stage: writes restricted to ${taskPlanPath}/`);
            }
          }
        }
        // No path field (Glob/Grep default to cwd) → allow
      }

      // Rule 5: Bash command filter
      if (toolName === "Bash") {
        const command = input.command as string | undefined;
        if (command) {
          const result = checkBashCommand(command, cwd);
          if (result.behavior === "deny") {
            return deny("Bash", `'${command}'`, result.message!);
          }
        }
      }

      // Default: allow
      return { behavior: "allow" };
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : "Unknown error";
      return deny(toolName, JSON.stringify(input), `Internal guard error: ${errMsg}`);
    }
  };
}

export function formatGuardSummary(
  stage: Stage,
  allowedTools: string[],
): string {
  const tools = allowedTools.join(", ");
  if (REVIEW_STAGES.has(stage)) {
    return `Guard: path-jail to ./  ·  tools: [${tools}]  ·  bash: blocked (review stage)`;
  }
  return `Guard: path-jail to ./  ·  tools: [${tools}]  ·  bash: ${BASH_BLOCKLIST.length} commands blocked`;
}
