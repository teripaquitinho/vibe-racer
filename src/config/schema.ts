import { z } from "zod";

export const configSchema = z.object({
  repo: z.string().refine(
    (val) => /github\.com[/:]([^/]+)\/([^/.]+)/.test(val),
    "repo must be a GitHub URL (HTTPS or SSH)",
  ).optional(),
  plans_dir: z.string().default("plans"),
  context: z
    .array(z.string())
    .default(["README.md", "CLAUDE.md"]),
});

export type VibeRacerConfig = z.infer<typeof configSchema>;
