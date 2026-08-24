import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { Stage } from "../state/schema.js";
import { createToolGuard, formatGuardSummary } from "./guard.js";
import { loadConfig } from "../config/loader.js";
import { LAP_BY_STAGE, resolveSkills, partitionSkills } from "./skills.js";
import { buildSkillsSection } from "./prompts.js";
import { log } from "../utils/logger.js";

export interface SessionOptions {
  prompt: string;
  persona: string;
  cwd: string;
  allowedTools?: string[];
  maxTurns?: number;
  stage?: Stage;
  taskPlanPath?: string;
  plansDir?: string;
  lap?: string | null;
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
      plansDir: options.plansDir ?? loadConfig(options.cwd).plans_dir,
    });
    canUseTool = guard;
    log.guard(formatGuardSummary(options.stage, options.allowedTools ?? []));
  }

  // Derive lap from stage when not explicitly given. Explicit `null` opts out entirely.
  const lap =
    options.lap === null
      ? undefined
      : options.lap ?? (options.stage ? LAP_BY_STAGE[options.stage] : undefined);

  // Resolve skills for this lap
  let skillsSection = "";
  let skillsRequested = false;
  if (lap) {
    const config = loadConfig(options.cwd);
    const requested = resolveSkills(lap, config);
    if (requested.length > 0) {
      skillsRequested = true;
      const probe = query({
        prompt: "",
        options: { cwd: options.cwd, settingSources: ["project", "user"], maxTurns: 0 },
      });
      try {
        const installed = await probe.supportedCommands();
        const { available, missing, ambiguous } = partitionSkills(requested, installed);
        if (missing.length > 0) {
          log.warn(`Skills not found (dropped from prompt): ${missing.join(", ")}`);
        }
        if (ambiguous.length > 0) {
          log.warn(
            `Skill name collision — more than one command matches: ${ambiguous.join(", ")}. ` +
              `Rename your local skill in ~/.claude/skills/ to disambiguate.`,
          );
        }
        skillsSection = buildSkillsSection(available);
      } catch (err) {
        // A failed probe must not fail the lap — degrade to persona-only.
        log.warn(`Skill discovery failed, continuing without skills: ${String(err)}`);
        skillsRequested = false;
      } finally {
        await probe.return(undefined);
      }
    }
  }

  const effectiveTools =
    skillsRequested && skillsSection
      ? [...(options.allowedTools ?? []), "Skill"]
      : options.allowedTools;

  const effectivePersona = skillsSection
    ? options.persona + skillsSection
    : options.persona;

  let result = "";

  for await (const message of query({
    prompt: options.prompt,
    options: {
      cwd: options.cwd,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: effectivePersona,
      },
      settingSources: ["project", "user"],
      allowedTools: effectiveTools,
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
