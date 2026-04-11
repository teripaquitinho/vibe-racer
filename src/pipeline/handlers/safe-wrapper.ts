import type { TaskContext } from "../types.js";
import { setError } from "../../state/store.js";
import { commitAll, createGit } from "../../git/operations.js";
import { log } from "../../utils/logger.js";

export function withErrorHandling(
  handlerName: string,
  handler: (ctx: TaskContext) => Promise<void>,
): (ctx: TaskContext) => Promise<void> {
  return async (ctx: TaskContext) => {
    try {
      await handler(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Handler [${handlerName}] failed: ${message}`);

      // Attempt to preserve partial work
      try {
        const git = createGit(ctx.cwd);
        await commitAll(git, `vibe-racer: partial work (error) for #${ctx.taskNumber}`);
        log.dim("Partial work committed");
      } catch {
        // Nothing to commit — that's fine
      }

      // Set error state
      try {
        setError(ctx.planPath, handlerName, message);
        log.dim("Error state saved");
      } catch {
        log.warn("Failed to save error state");
      }

      throw err;
    }
  };
}
