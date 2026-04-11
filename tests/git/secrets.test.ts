import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkFileName, checkFileContent, scanFiles } from "../../src/git/secrets.js";

// Mock node:fs for content scanning
const mockReadFileSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

describe("checkFileName", () => {
  it("flags .env", () => {
    expect(checkFileName("/project/.env")).not.toBeNull();
  });

  it("flags .env.local", () => {
    expect(checkFileName("/project/.env.local")).not.toBeNull();
  });

  it("flags .env.production", () => {
    expect(checkFileName("/project/.env.production")).not.toBeNull();
  });

  it("flags credentials.json", () => {
    expect(checkFileName("/project/credentials.json")).not.toBeNull();
  });

  it("flags server.pem", () => {
    expect(checkFileName("/project/certs/server.pem")).not.toBeNull();
  });

  it("flags private.key", () => {
    expect(checkFileName("/project/private.key")).not.toBeNull();
  });

  it("allows normal source files", () => {
    expect(checkFileName("/project/src/index.ts")).toBeNull();
  });

  it("allows package.json", () => {
    expect(checkFileName("/project/package.json")).toBeNull();
  });

  it("allows .environment.ts", () => {
    expect(checkFileName("/project/.environment.ts")).toBeNull();
  });
});

describe("checkFileContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects AWS access key", () => {
    mockReadFileSync.mockReturnValue(Buffer.from("key=AKIAIOSFODNN7EXAMPLE"));
    expect(checkFileContent("/project/config.ts")).not.toBeNull();
    expect(checkFileContent("/project/config.ts")).toContain("AKIA");
  });

  it("detects PEM private key block", () => {
    mockReadFileSync.mockReturnValue(
      Buffer.from("-----BEGIN RSA PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----"),
    );
    expect(checkFileContent("/project/key.txt")).not.toBeNull();
  });

  it("detects GitHub personal access token", () => {
    mockReadFileSync.mockReturnValue(
      Buffer.from("token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"),
    );
    expect(checkFileContent("/project/config.ts")).not.toBeNull();
  });

  it("detects API key pattern (sk-...)", () => {
    mockReadFileSync.mockReturnValue(
      Buffer.from("api_key=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv"),
    );
    expect(checkFileContent("/project/config.ts")).not.toBeNull();
  });

  it("allows normal source file content", () => {
    mockReadFileSync.mockReturnValue(
      Buffer.from('export function hello() { return "world"; }'),
    );
    expect(checkFileContent("/project/src/index.ts")).toBeNull();
  });

  it("skips files larger than 100 KB", () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(100 * 1024 + 1));
    expect(checkFileContent("/project/large-file.bin")).toBeNull();
  });

  it("returns null when file cannot be read", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(checkFileContent("/project/missing.ts")).toBeNull();
  });
});

describe("scanFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(Buffer.from("safe content"));
  });

  it("returns matches for flagged filenames", () => {
    const hits = scanFiles(["/project/.env", "/project/src/index.ts"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe("/project/.env");
  });

  it("returns matches for flagged content", () => {
    mockReadFileSync.mockReturnValue(Buffer.from("key=AKIAIOSFODNN7EXAMPLE"));
    const hits = scanFiles(["/project/config.ts"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Content matches");
  });

  it("returns empty array for clean files", () => {
    const hits = scanFiles(["/project/src/index.ts", "/project/README.md"]);
    expect(hits).toHaveLength(0);
  });

  it("skips content scan when filename already flagged", () => {
    const hits = scanFiles(["/project/.env"]);
    expect(hits).toHaveLength(1);
    // readFileSync should not be called since filename already matched
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });
});
