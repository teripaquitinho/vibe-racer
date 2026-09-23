/**
 * Fence-aware line scanning for the two files the pipeline reads back out of a plan folder:
 * the Execution Status table and the operator pause block, both in `04_execute.md`.
 *
 * It exists because they used to disagree. `operator-block.ts` tracked fences and blockquotes;
 * `execute-table.ts` matched headings with a bare regex, so a table quoted into a playbook —
 * the worked example from the prompts, say — outranked the real one and the loop executed it.
 * One scanner, one rule, both readers.
 *
 * A leaf module by design: no imports at all, so `execute-table.ts` can use it and still be
 * interpolated into prompts without a cycle.
 */

export interface ScannedLine {
  /** Index into the array that was scanned, not necessarily into the whole file. */
  index: number;
  raw: string;
  /** Inside a fenced block, or the fence delimiter itself. */
  fenced: boolean;
  /** A blockquote line — where a pause block's quoted agent message lives. */
  quoted: boolean;
}

export const FENCE_RE = /^(`{3,}|~{3,})/;

/**
 * Walks lines tracking fence state for both ``` and ~~~ runs, matching run length, so a fence
 * inside the agent's quoted message cannot close the fence that contains it.
 *
 * A fence that is never closed swallows the rest of the file, exactly as CommonMark says it
 * does. That is a real hazard for the reader — a stray ```` ``` ```` above a pause block hides
 * it — so callers that can be defeated this way say so rather than failing silently.
 */
export function scanLines(lines: string[]): ScannedLine[] {
  const out: ScannedLine[] = [];
  let fence: { char: string; length: number } | null = null;

  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    const match = FENCE_RE.exec(trimmed);
    let fenced = fence !== null;

    if (match) {
      const char = match[1][0];
      const length = match[1].length;
      if (fence === null) {
        fence = { char, length };
        fenced = true;
      } else if (char === fence.char && length >= fence.length && trimmed === match[1]) {
        fence = null;
        fenced = true;
      }
    }
    out.push({ index, raw, fenced, quoted: /^\s*>/.test(raw) });
  });
  return out;
}

/** An ATX heading that is really a heading: column 0, outside every fence and blockquote. */
export function isHeading(line: ScannedLine): boolean {
  return !line.fenced && !line.quoted && /^#{1,6}\s/.test(line.raw);
}

/** Neither fenced nor quoted — a line that counts as content of the document itself. */
export function isLive(line: ScannedLine): boolean {
  return !line.fenced && !line.quoted;
}
