import path from "path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "fs/promises";
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
/** Default only — `max_turns.qa` in .vibe-racer.yml overrides it (resolved in runAndStream). */
const MAX_TURNS = 100;

/** How the SDK words a session that ran out of turns. */
const TURN_LIMIT_ERROR = /maximum number of turns/i;

export const INCOMPLETE_BANNER =
  "> **QA stopped at its turn limit — this report is incomplete.** Sections below may be " +
  "partial or empty. Re-run the lap (`stage: ai_qa` in state.yml, then `drive`) or raise " +
  "`max_turns.qa` in .vibe-racer.yml if the gaps matter.";

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

  const qaPath = path.join(ctx.cwd, ctx.planPath, "05_qa.md");

  try {
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
  } catch (err) {
    // The prompt makes the session write 05_qa.md early and grow it, so a turn limit cuts
    // the review short rather than wiping it out. A partial report goes to the operator,
    // flagged; any other failure, or a limit hit before anything was written, still fails.
    const message = err instanceof Error ? err.message : String(err);
    if (!TURN_LIMIT_ERROR.test(message) || !existsSync(qaPath)) throw err;
    log.warn(`QA hit its turn limit — keeping the partial 05_qa.md: ${message}`);
    const partial = await readFile(qaPath, "utf-8");
    await writeFile(qaPath, `${INCOMPLETE_BANNER}\n\n${partial}`);
  }

  // Verify 05_qa.md was written before advancing. Advancing without it strands the task:
  // fine_tuning points at 05_qa.md, tryAdvance returns no_questions_file, and there is no
  // forward path.
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
