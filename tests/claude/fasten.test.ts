import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const fixtureWithFindings = actualFs.readFileSync(
  path.join(__dirname, "../fixtures/fasten-with-findings.md"),
  "utf-8",
) as string;
const fixtureEmpty = actualFs.readFileSync(
  path.join(__dirname, "../fixtures/fasten-empty.md"),
  "utf-8",
) as string;

const mockRunAndStream = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(false);
const mockReadFileSync = vi.fn();

vi.mock("../../src/claude/session.js", () => ({
  runAndStream: (...args: unknown[]) => mockRunAndStream(...args),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  };
});

describe("runFastenAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  async function loadModule() {
    return import("../../src/claude/fasten.js");
  }

  it("prompt includes all 6 dead code categories", async () => {
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);
    const { runFastenAnalysis } = await loadModule();
    await runFastenAnalysis("/tmp/project");

    const prompt = mockRunAndStream.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Unused exports");
    expect(prompt).toContain("Unreachable code");
    expect(prompt).toContain("Unused variables and imports");
    expect(prompt).toContain("Dead feature flags");
    expect(prompt).toContain("Unused files/modules");
    expect(prompt).toContain("Deprecated internal APIs");
  });

  it("prompt includes the output template with 2-bucket table format", async () => {
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);
    const { runFastenAnalysis } = await loadModule();
    await runFastenAnalysis("/tmp/project");

    const prompt = mockRunAndStream.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("## Safe to Delete");
    expect(prompt).toContain("## Needs Review");
    // "Keep but Flag" has been merged into "Needs Review".
    expect(prompt).not.toContain("## Keep but Flag");
  });

  it("prompt explicitly forbids preamble/filler", async () => {
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);
    const { runFastenAnalysis } = await loadModule();
    await runFastenAnalysis("/tmp/project");

    const prompt = mockRunAndStream.mock.calls[0][0].prompt as string;
    expect(prompt).toMatch(/no preamble|any preamble/i);
    expect(prompt).toContain("Dead code analysis for this project");
  });

  it("prompt does NOT include completion checkbox or # Objective heading (caller adds them)", async () => {
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);
    const { runFastenAnalysis } = await loadModule();
    await runFastenAnalysis("/tmp/project");

    const prompt = mockRunAndStream.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("- [ ] Ready to advance to Plan Questions");
    expect(prompt).not.toMatch(/^#\s+Objective/m);
    expect(prompt).not.toMatch(/^#\s+Complete/m);
  });

  it("calls runAndStream with allowedTools: Read, Glob, Grep", async () => {
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);
    const { runFastenAnalysis } = await loadModule();
    await runFastenAnalysis("/tmp/project");

    expect(mockRunAndStream).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedTools: ["Read", "Glob", "Grep"],
      }),
    );
  });

  it("calls runAndStream with stage ai_objective_review and empty taskPlanPath", async () => {
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);
    const { runFastenAnalysis } = await loadModule();
    await runFastenAnalysis("/tmp/project");

    expect(mockRunAndStream).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "ai_objective_review",
        taskPlanPath: "",
      }),
    );
  });

  it("calls runAndStream with empty persona", async () => {
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);
    const { runFastenAnalysis } = await loadModule();
    await runFastenAnalysis("/tmp/project");

    expect(mockRunAndStream).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: "",
      }),
    );
  });

  it("returns isEmpty: false when output has findings and strips # Objective / # Complete", async () => {
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);
    const { runFastenAnalysis } = await loadModule();
    const result = await runFastenAnalysis("/tmp/project");

    expect(result.isEmpty).toBe(false);
    // Sanitizer strips the redundant heading + completion section.
    expect(result.output).not.toMatch(/^#\s+Objective/m);
    expect(result.output).not.toMatch(/#\s+Complete/);
    expect(result.output).not.toContain("Ready to advance to Plan Questions");
    // Body is preserved.
    expect(result.output).toContain("## Summary");
    expect(result.output).toContain("## Needs Review");
  });

  it("sanitizer strips model preamble before the anchor line", async () => {
    const withPreamble = `I now have all the data I need. Here's the analysis:\n\nDead code analysis for this project — run by \`vibe-racer fasten\` on 2026-04-15.\n\n## Summary\n\nFound 1 item: 1 safe to delete.\n`;
    mockRunAndStream.mockResolvedValue(withPreamble);
    const { runFastenAnalysis } = await loadModule();
    const result = await runFastenAnalysis("/tmp/project");

    expect(result.output.startsWith("Dead code analysis for this project")).toBe(true);
    expect(result.output).not.toContain("I now have all the data I need");
    expect(result.output).not.toContain("Here's the analysis");
  });

  it("returns isEmpty: true when output contains 'no dead code found' (case-insensitive)", async () => {
    mockRunAndStream.mockResolvedValue(fixtureEmpty);
    const { runFastenAnalysis } = await loadModule();
    const result = await runFastenAnalysis("/tmp/project");

    expect(result.isEmpty).toBe(true);
    expect(result.output).not.toMatch(/^#\s+Objective/m);
    expect(result.output).not.toMatch(/#\s+Complete/);
  });

  it("returns isEmpty: true for mixed-case 'No Dead Code Found'", async () => {
    mockRunAndStream.mockResolvedValue("Summary: No Dead Code Found.");
    const { runFastenAnalysis } = await loadModule();
    const result = await runFastenAnalysis("/tmp/project");

    expect(result.isEmpty).toBe(true);
  });

  it("returns isEmpty: false when output has findings but not the phrase", async () => {
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);
    const { runFastenAnalysis } = await loadModule();
    const result = await runFastenAnalysis("/tmp/project");

    expect(result.isEmpty).toBe(false);
  });

  it("throws when runAndStream returns empty string", async () => {
    mockRunAndStream.mockResolvedValue("");
    const { runFastenAnalysis } = await loadModule();

    await expect(runFastenAnalysis("/tmp/project")).rejects.toThrow(
      "Analysis failed. Run vibe-racer fasten again to retry.",
    );
  });

  it("includes README.md content in prompt when file exists", async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      return String(p).endsWith("README.md");
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      if (String(p).endsWith("README.md")) return "# My Project\n\nA great project.";
      throw new Error(`Unexpected readFileSync call: ${p}`);
    });
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);

    const { runFastenAnalysis } = await loadModule();
    await runFastenAnalysis("/tmp/project");

    const prompt = mockRunAndStream.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("# My Project");
    expect(prompt).toContain("A great project.");
  });

  it("works without README.md or CLAUDE.md (graceful degradation)", async () => {
    mockExistsSync.mockReturnValue(false);
    mockRunAndStream.mockResolvedValue(fixtureWithFindings);

    const { runFastenAnalysis } = await loadModule();
    const result = await runFastenAnalysis("/tmp/project");

    expect(result.output).toContain("## Summary");
    const prompt = mockRunAndStream.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("## Project README");
    expect(prompt).not.toContain("## Project CLAUDE.md");
  });
});
