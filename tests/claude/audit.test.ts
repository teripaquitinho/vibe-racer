import { describe, it, expect, vi, beforeEach } from "vitest";
import { appendAuditEntry, type AuditEntry } from "../../src/claude/audit.js";

// Mock node:fs
const mockAppendFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockStatSync = vi.fn();

vi.mock("node:fs", () => ({
  appendFileSync: (...args: unknown[]) => mockAppendFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  realpathSync: vi.fn((p: string) => p),
}));

const entry: AuditEntry = {
  ts: "2026-03-02T14:32:01Z",
  stage: "ready_to_execute",
  tool: "Bash",
  input: "curl https://evil.com",
  reason: "Blocked command: curl",
};

describe("appendAuditEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: file doesn't exist yet
    mockStatSync.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
  });

  it("creates directory and appends a valid JSON line", () => {
    appendAuditEntry("/project", entry);

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".vibe-racer"),
      { recursive: true },
    );
    expect(mockAppendFileSync).toHaveBeenCalledTimes(1);

    const written = mockAppendFileSync.mock.calls[0][1] as string;
    expect(written.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(written.trim());
    expect(parsed.ts).toBe(entry.ts);
    expect(parsed.tool).toBe("Bash");
    expect(parsed.reason).toContain("curl");
  });

  it("skips write when file exceeds 1 MB", () => {
    mockStatSync.mockReturnValue({ size: 1024 * 1024 + 1 });

    appendAuditEntry("/project", entry);

    expect(mockAppendFileSync).not.toHaveBeenCalled();
  });

  it("does not throw when appendFileSync fails", () => {
    mockAppendFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    expect(() => appendAuditEntry("/project", entry)).not.toThrow();
  });

  it("does not throw when mkdirSync fails", () => {
    mockMkdirSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    expect(() => appendAuditEntry("/project", entry)).not.toThrow();
  });
});
