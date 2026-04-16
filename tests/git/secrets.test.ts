import { describe, it, expect, vi, beforeEach } from "vitest";
import { scanFiles } from "../../src/git/secrets.js";

// Mock node:fs for content scanning
const mockReadFileSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

describe("scanFiles — filename detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(Buffer.from("safe content"));
  });

  it("flags .env", () => {
    const hits = scanFiles(["/project/.env"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Filename matches");
  });

  it("flags .env.local", () => {
    const hits = scanFiles(["/project/.env.local"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Filename matches");
  });

  it("flags .env.production", () => {
    const hits = scanFiles(["/project/.env.production"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Filename matches");
  });

  it("flags credentials.json", () => {
    const hits = scanFiles(["/project/credentials.json"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Filename matches");
  });

  it("flags server.pem", () => {
    const hits = scanFiles(["/project/certs/server.pem"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Filename matches");
  });

  it("flags private.key", () => {
    const hits = scanFiles(["/project/private.key"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Filename matches");
  });

  it("allows normal source files", () => {
    const hits = scanFiles(["/project/src/index.ts"]);
    expect(hits).toHaveLength(0);
  });

  it("allows package.json", () => {
    const hits = scanFiles(["/project/package.json"]);
    expect(hits).toHaveLength(0);
  });

  it("allows .environment.ts", () => {
    const hits = scanFiles(["/project/.environment.ts"]);
    expect(hits).toHaveLength(0);
  });
});

describe("scanFiles — content detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects AWS access key", () => {
    mockReadFileSync.mockReturnValue(Buffer.from("key=AKIAIOSFODNN7EXAMPLE"));
    const hits = scanFiles(["/project/config.js"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Content matches");
  });

  it("detects PEM private key block", () => {
    mockReadFileSync.mockReturnValue(
      Buffer.from("-----BEGIN RSA PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----"),
    );
    const hits = scanFiles(["/project/key.txt"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Content matches");
  });

  it("detects GitHub personal access token", () => {
    mockReadFileSync.mockReturnValue(
      Buffer.from("token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"),
    );
    const hits = scanFiles(["/project/config.js"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Content matches");
  });

  it("detects API key pattern (sk-...)", () => {
    mockReadFileSync.mockReturnValue(
      Buffer.from("api_key=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv"),
    );
    const hits = scanFiles(["/project/config.js"]);
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain("Content matches");
  });

  it("allows normal source file content", () => {
    mockReadFileSync.mockReturnValue(
      Buffer.from('export function hello() { return "world"; }'),
    );
    const hits = scanFiles(["/project/src/index.ts"]);
    expect(hits).toHaveLength(0);
  });

  it("skips files larger than 100 KB", () => {
    mockReadFileSync.mockReturnValue(Buffer.alloc(100 * 1024 + 1));
    const hits = scanFiles(["/project/large-file.bin"]);
    expect(hits).toHaveLength(0);
  });

  it("returns empty when file cannot be read", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const hits = scanFiles(["/project/missing.ts"]);
    expect(hits).toHaveLength(0);
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
