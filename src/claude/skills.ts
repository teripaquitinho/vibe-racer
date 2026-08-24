import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { Stage } from "../state/schema.js";
import type { VibeRacerConfig } from "../config/schema.js";

/**
 * Every agent stage maps to exactly one lap. This bijection is what lets all seven laps
 * pick up skills without threading a `lap` argument through six call sites — runAndStream
 * already receives `stage`.
 */
export const LAP_BY_STAGE: Partial<Record<Stage, string>> = {
  ai_objective_review: "objective",
  ai_product_review: "product",
  ai_design_review: "design",
  ai_plan_review: "plan",
  ready_to_execute: "execute",
  ai_qa: "qa",
  cleanup_ready: "decision",
};

/**
 * Verified installed as of 2026-08-24 (see Spike result in 03_plan.md). Names here MUST
 * appear in `supportedCommands()` output — an unverified name costs a warning on every
 * single lap.
 */
export const DEFAULT_SKILLS: Record<string, string[]> = {
  objective: [],
  product: [],
  design: [],
  plan: [],
  execute: ["simplify"],
  qa: ["security-review"],
  decision: [],
};

export function resolveSkills(lap: string, config: VibeRacerConfig): string[] {
  return config.skills?.[lap] ?? DEFAULT_SKILLS[lap] ?? [];
}

export function partitionSkills(
  requested: string[],
  installed: SlashCommand[],
): { available: SlashCommand[]; missing: string[]; ambiguous: string[] } {
  // Names are NOT unique — a local skill can shadow a bundled command (observed: `debug`).
  // Count first, so a duplicated name is reported rather than silently resolved.
  const counts = new Map<string, number>();
  for (const s of installed) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);

  const installedMap = new Map(installed.map((s) => [s.name, s]));
  const available: SlashCommand[] = [];
  const missing: string[] = [];
  const ambiguous: string[] = [];
  for (const name of requested) {
    const skill = installedMap.get(name);
    if (!skill) {
      missing.push(name);
      continue;
    }
    if ((counts.get(name) ?? 0) > 1) ambiguous.push(name);
    available.push(skill);
  }
  return { available, missing, ambiguous };
}
