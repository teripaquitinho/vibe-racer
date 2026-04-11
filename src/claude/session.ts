import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { Stage } from "../state/schema.js";
import { createToolGuard, formatGuardSummary } from "./guard.js";
import { log } from "../utils/logger.js";

export interface SessionOptions {
  prompt: string;
  persona: string;
  cwd: string;
  allowedTools?: string[];
  maxTurns?: number;
  stage?: Stage;
  taskPlanPath?: string;
}

export async function runAndStream(options: SessionOptions): Promise<string> {
  log.dim("─".repeat(60));
  log.info("Claude Code session started");
  log.dim("─".repeat(60));

  let canUseTool: CanUseTool | undefined;
  if (options.stage) {
    const guard = createToolGuard({
      cwd: options.cwd,
      stage: options.stage,
      taskPlanPath: options.taskPlanPath ?? "",
    });
    canUseTool = guard;
    log.guard(formatGuardSummary(options.stage, options.allowedTools ?? []));
  }

  let result = "";

  for await (const message of query({
    prompt: options.prompt,
    options: {
      cwd: options.cwd,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: options.persona,
      },
      settingSources: ["project"],
      allowedTools: options.allowedTools,
      maxTurns: options.maxTurns,
      includePartialMessages: true,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      canUseTool,
    },
  })) {
    if (message.type === "stream_event") {
      const event = message.event;
      if (
        event.type === "content_block_delta" &&
        "delta" in event &&
        event.delta.type === "text_delta"
      ) {
        process.stdout.write(event.delta.text);
      }
    }

    if (message.type === "result" && "result" in message) {
      result = (message as { result: string }).result;
      log.dim("\n" + "─".repeat(60));
      log.success(
        `Session complete — ${message.num_turns} turns, $${message.total_cost_usd.toFixed(4)}`,
      );
      log.dim("─".repeat(60));
    }
  }

  return result;
}
