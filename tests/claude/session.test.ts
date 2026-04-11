import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionOptions } from "../../src/claude/session.js";

const mockQuery = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

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

describe("runAndStream", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  const baseOptions: SessionOptions = {
    prompt: "Do something",
    persona: "You are an expert.",
    cwd: "/tmp/repo",
    allowedTools: ["Read", "Write"],
    maxTurns: 10,
  };

  it("calls query with correct options", async () => {
    async function* fakeStream() {
      yield {
        type: "result" as const,
        result: "done",
        num_turns: 1,
        total_cost_usd: 0.01,
      };
    }
    mockQuery.mockReturnValue(fakeStream());

    const { runAndStream } = await import("../../src/claude/session.js");
    await runAndStream(baseOptions);

    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "Do something",
      options: expect.objectContaining({
        cwd: "/tmp/repo",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "You are an expert.",
        },
        settingSources: ["project"],
        allowedTools: ["Read", "Write"],
        maxTurns: 10,
        includePartialMessages: true,
      }),
    });
  });

  it("streams text deltas to stdout", async () => {
    async function* fakeStream() {
      yield {
        type: "stream_event" as const,
        event: {
          type: "content_block_delta" as const,
          delta: { type: "text_delta" as const, text: "Hello " },
        },
      };
      yield {
        type: "stream_event" as const,
        event: {
          type: "content_block_delta" as const,
          delta: { type: "text_delta" as const, text: "world" },
        },
      };
      yield {
        type: "result" as const,
        result: "Hello world",
        num_turns: 1,
        total_cost_usd: 0.005,
      };
    }
    mockQuery.mockReturnValue(fakeStream());

    const { runAndStream } = await import("../../src/claude/session.js");
    const result = await runAndStream(baseOptions);

    expect(process.stdout.write).toHaveBeenCalledWith("Hello ");
    expect(process.stdout.write).toHaveBeenCalledWith("world");
    expect(result).toBe("Hello world");
  });

  it("returns result string from result message", async () => {
    async function* fakeStream() {
      yield {
        type: "result" as const,
        result: "final output",
        num_turns: 3,
        total_cost_usd: 0.02,
      };
    }
    mockQuery.mockReturnValue(fakeStream());

    const { runAndStream } = await import("../../src/claude/session.js");
    const result = await runAndStream(baseOptions);

    expect(result).toBe("final output");
  });

  it("ignores non-text-delta stream events", async () => {
    async function* fakeStream() {
      yield {
        type: "stream_event" as const,
        event: {
          type: "content_block_start" as const,
          content_block: { type: "text" },
        },
      };
      yield {
        type: "stream_event" as const,
        event: {
          type: "content_block_delta" as const,
          delta: { type: "input_json_delta" as const, partial_json: "{}" },
        },
      };
      yield {
        type: "result" as const,
        result: "",
        num_turns: 1,
        total_cost_usd: 0.001,
      };
    }
    mockQuery.mockReturnValue(fakeStream());

    const { runAndStream } = await import("../../src/claude/session.js");
    await runAndStream(baseOptions);

    // stdout.write should not have been called with any text content
    const writeCalls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
    const textWrites = writeCalls.filter(
      ([arg]: [unknown]) => typeof arg === "string" && arg !== "",
    );
    expect(textWrites).toHaveLength(0);
  });
});
