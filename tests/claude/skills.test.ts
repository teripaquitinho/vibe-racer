import { describe, it, expect } from "vitest";
import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { isAgentStage } from "../../src/pipeline/states.js";
import { STAGES } from "../../src/state/schema.js";
import {
  LAP_BY_STAGE,
  DEFAULT_SKILLS,
  resolveSkills,
  partitionSkills,
} from "../../src/claude/skills.js";

describe("LAP_BY_STAGE", () => {
  it("covers every agent stage", () => {
    const agentStages = STAGES.filter((s) => isAgentStage(s));
    for (const stage of agentStages) {
      expect(LAP_BY_STAGE[stage]).toBeDefined();
    }
  });

  it("maps each stage to a distinct lap name that exists in DEFAULT_SKILLS", () => {
    const laps = new Set<string>();
    for (const [stage, lap] of Object.entries(LAP_BY_STAGE)) {
      expect(lap).toBeDefined();
      expect(DEFAULT_SKILLS).toHaveProperty(lap!);
      // Each stage maps to a distinct lap
      expect(laps.has(lap!)).toBe(false);
      laps.add(lap!);
    }
  });
});

describe("DEFAULT_SKILLS", () => {
  it("every name is non-empty and lowercase-kebab", () => {
    for (const [lap, names] of Object.entries(DEFAULT_SKILLS)) {
      for (const name of names) {
        expect(name).toBeTruthy();
        expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });
});

describe("resolveSkills", () => {
  it("returns config values when config provides skills for a lap", () => {
    const config = {
      plans_dir: "plans",
      context: ["README.md"],
      skills: { qa: ["code-review", "test-runner"] },
    };
    expect(resolveSkills("qa", config)).toEqual(["code-review", "test-runner"]);
  });

  it("returns built-in defaults when config has no skills key", () => {
    const config = { plans_dir: "plans", context: ["README.md"] };
    expect(resolveSkills("execute", config)).toEqual(["simplify"]);
    expect(resolveSkills("qa", config)).toEqual(["security-review"]);
  });

  it("returns empty array for an unknown lap", () => {
    const config = { plans_dir: "plans", context: ["README.md"] };
    expect(resolveSkills("unknown-lap", config)).toEqual([]);
  });

  it("config replaces defaults entirely (not additive)", () => {
    const config = {
      plans_dir: "plans",
      context: ["README.md"],
      skills: { execute: [] },
    };
    expect(resolveSkills("execute", config)).toEqual([]);
  });
});

describe("partitionSkills", () => {
  const makeSkill = (name: string, desc = "desc"): SlashCommand => ({
    name,
    description: desc,
    argumentHint: "",
  });

  it("splits correctly between available and missing", () => {
    const installed = [makeSkill("simplify"), makeSkill("security-review")];
    const result = partitionSkills(["simplify", "unknown"], installed);

    expect(result.available).toHaveLength(1);
    expect(result.available[0].name).toBe("simplify");
    expect(result.missing).toEqual(["unknown"]);
    expect(result.ambiguous).toEqual([]);
  });

  it("returns full SlashCommand objects for available skills", () => {
    const installed = [makeSkill("simplify", "Review changed code")];
    const { available } = partitionSkills(["simplify"], installed);

    expect(available[0]).toEqual({
      name: "simplify",
      description: "Review changed code",
      argumentHint: "",
    });
  });

  it("returns empty outputs for empty inputs", () => {
    const result = partitionSkills([], []);
    expect(result.available).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it("reports a duplicated name in ambiguous while still returning it in available", () => {
    const installed = [
      makeSkill("debug", "Built-in debug"),
      makeSkill("debug", "Custom debug skill"),
    ];
    const result = partitionSkills(["debug"], installed);

    expect(result.ambiguous).toEqual(["debug"]);
    // Still returned in available (dropping it would be worse)
    expect(result.available).toHaveLength(1);
    expect(result.available[0].name).toBe("debug");
  });

  it("a requested name present exactly once is NOT reported ambiguous", () => {
    const installed = [makeSkill("simplify"), makeSkill("security-review")];
    const result = partitionSkills(["simplify"], installed);

    expect(result.ambiguous).toEqual([]);
    expect(result.available).toHaveLength(1);
  });
});
