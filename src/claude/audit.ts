import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";

const MAX_AUDIT_SIZE = 1024 * 1024; // 1 MB

export interface AuditEntry {
  ts: string;
  stage: string;
  tool: string;
  input: string;
  reason: string;
}

export function appendAuditEntry(cwd: string, entry: AuditEntry): void {
  try {
    const logPath = resolve(cwd, ".vibe-racer", "audit.log");
    mkdirSync(dirname(logPath), { recursive: true });

    // Check size — skip if over cap (avoid unbounded growth)
    try {
      const stats = statSync(logPath);
      if (stats.size >= MAX_AUDIT_SIZE) return;
    } catch {
      // File doesn't exist yet — fine, we'll create it
    }

    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    // Audit write failures must not break the guard
  }
}
