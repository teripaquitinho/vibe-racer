import path from "path";
import { existsSync, appendFileSync } from "node:fs";
import type { TaskContext } from "../types.js";
import { runAndStream } from "../../claude/session.js";
import { donePrompt, decisionPrompt } from "../../claude/prompts.js";
import { commitAll, createGit } from "../../git/operations.js";
import { updateStage } from "../../state/store.js";
import { completionSection } from "../validation.js";
import { log } from "../../utils/logger.js";

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];
const DECISION_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write"];
const DECISION_MAX_TURNS = 30;

export async function handleDone(ctx: TaskContext): Promise<void> {
  const { prompt, persona } = donePrompt(ctx);

  log.info("Running final docs + cleanup...");
  await runAndStream({
    prompt,
    persona,
    cwd: ctx.cwd,
    allowedTools: ALLOWED_TOOLS,
    stage: "cleanup_ready",
    taskPlanPath: ctx.planPath,
    plansDir: ctx.plansDir,
  });

  // Second session: write 06_decision.md
  const { prompt: decPrompt, persona: decPersona } = decisionPrompt(ctx);

  log.info("Writing decision checklist...");
  await runAndStream({
    prompt: decPrompt,
    persona: decPersona,
    cwd: ctx.cwd,
    allowedTools: DECISION_ALLOWED_TOOLS,
    stage: "cleanup_ready",
    taskPlanPath: ctx.planPath,
    plansDir: ctx.plansDir,
    maxTurns: DECISION_MAX_TURNS,
  });

  // Verify 06_decision.md exists; throw if not
  const decisionPath = path.join(ctx.cwd, ctx.planPath, "06_decision.md");
  if (!existsSync(decisionPath)) {
    throw new Error("Decision session did not produce 06_decision.md");
  }

  appendFileSync(decisionPath, completionSection("Done"), "utf-8");

  updateStage(ctx.planPath, "need_decision");
  log.success("Stage advanced to [need_decision]");

  const git = createGit(ctx.cwd);
  const hash = await commitAll(
    git,
    `vibe-racer: cleanup + decision checklist for #${ctx.taskNumber}`,
    ctx.cwd,
  );
  if (hash) log.success(`Committed: ${hash}`);
  log.info("Work the checklist in 06_decision.md, then tick all checkboxes.");
}
