# Objective

Dead code analysis for this project — run by `vibe-racer fasten` on 2026-04-15.

## Summary

Found 5 items: 3 safe to delete, 1 needs review, 1 to keep but flag.

## Safe to Delete

Items with **high confidence** that can be removed without risk.

| # | File | Line | Type | Why it appears dead | Action |
|---|------|------|------|---------------------|--------|
| 1 | src/utils/legacy.ts | 12 | Unused export | Exported but never imported anywhere | Delete |
| 2 | src/helpers/format.ts | 45 | Unreachable code | Code after early return on line 42 | Delete |
| 3 | src/lib/old-api.ts | 1 | Unused file | Never imported by any module | Delete |

## Needs Review

Items with **medium or low confidence** — may have dynamic usage, reflection, or external consumers.

| # | File | Line | Type | Why it appears dead | Confidence | Action |
|---|------|------|------|---------------------|------------|--------|
| 1 | src/api/handler.ts | 78 | Unused import | Imported but never referenced in this file | Medium | Investigate |

## Keep but Flag

Items that are technically dead but should be preserved for now (e.g., public API surface, upcoming feature flags).

| # | File | Line | Type | Why it's flagged | Reason to keep |
|---|------|------|------|------------------|----------------|
| 1 | src/index.ts | 5 | Unused export | Exported but not consumed internally | Public API surface |

# Complete

- [ ] Ready to advance to Plan Questions
