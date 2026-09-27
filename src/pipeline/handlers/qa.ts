import path from "path";
import { existsSync } from "node:fs";
import { readFile } from "fs/promises";
import type { TaskContext } from "../types.js";
import { runAndStream } from "../../claude/session.js";
import { qaPrompt } from "../../claude/prompts.js";
import { commitAll, createGit } from "../../git/operations.js";
import { updateStage } from "../../state/store.js";
import { ensureCompletionSection } from "../validation.js";
import {
  EXECUTION_PLAYBOOK_FILE,
  operatorGates,
  parseExecutionStatus,
} from "../execute-table.js";
import { log } from "../../utils/logger.js";

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write", "Bash"];
const MAX_TURNS = 60;

/**
 * The operator gates execution passed through, as `G<n> — <name>`, so the QA report can state
 * its coverage up front. A playbook the parser rejects yields `[]` and a warning: execution
 * already sailed past this file, and the QA lap must not die on it now.
 */
async function gatesPassed(ctx: TaskContext): Promise<string[]> {
  const label = `${ctx.planPath}/${EXECUTION_PLAYBOOK_FILE}`;
  try {
    const content = await readFile(path.join(ctx.cwd, label), "utf-8");
    return operatorGates(parseExecutionStatus(content, label)).map(
      (row) => `${row.id} — ${row.name}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Could not read operator gates from ${label} — QA runs without a gate list: ${message}`);
    return [];
  }
}

export async function handleQa(ctx: TaskContext): Promise<void> {
  const gates = await gatesPassed(ctx);
  const { prompt, persona } = qaPrompt(ctx, gates);

  await runAndStream({
    prompt,
    persona,
    cwd: ctx.cwd,
    allowedTools: ALLOWED_TOOLS,
    stage: "ai_qa",
    taskPlanPath: ctx.planPath,
    plansDir: ctx.plansDir,
    maxTurns: MAX_TURNS,
  });

  // Verify 05_qa.md was written before advancing. Advancing without it strands the task:
  // fine_tuning points at 05_qa.md, tryAdvance returns no_questions_file, and there is no
  // forward path.
  const qaPath = path.join(ctx.cwd, ctx.planPath, "05_qa.md");
  if (!existsSync(qaPath)) {
    throw new Error("QA session did not produce 05_qa.md");
  }

  ensureCompletionSection(qaPath, "Cleanup");

  updateStage(ctx.planPath, "fine_tuning");

  const git = createGit(ctx.cwd);
  const hash = await commitAll(git, `vibe-racer: QA review for #${ctx.taskNumber}`, ctx.cwd);
  if (hash) log.success(`Committed: ${hash}`);

  log.info("Review QA findings in 05_qa.md, then tick the checkbox.");
}
