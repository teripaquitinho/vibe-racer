# Objective

Dead code analysis for this project — run by `vibe-racer fasten` on 2026-04-16.

## Summary

Found 20 items: 5 safe to delete, 15 need review.

## Safe to Delete

Items with **high confidence** that can be removed without risk.

| # | File | Line | Type | Why it appears dead | Action |
|---|------|------|------|---------------------|--------|
| 1 | `src/pipeline/states.ts` | 1–56 | Deprecated API | Entire label-based API block (`LabelDefinition`, `LABELS`, `AGENT_ACTIONABLE`, `isAgentActionable`, `isviberacerLabel`, `LABEL_ORDER`, `nextLabel`, `previousLabel`) — fully replaced by stage-based API on lines 58–109. Migration comment on line 58 confirms coexistence period; no production code imports any of these symbols. | Delete |
| 2 | `src/config/loader.ts` | 43–61 | Deprecated API | `detectProjectInfo` — uses raw `execSync("git remote get-url origin")`, replaced by `getRemoteUrl(git)` in `src/git/operations.ts` which uses `simple-git`. Never imported anywhere. | Delete |
| 3 | `src/config/loader.ts` | 30–41 | Unused export | `parseRepoUrl` — never imported in any source or test file. Same regex duplicated in `src/config/schema.ts` and `src/utils/links.ts`. | Delete |
| 4 | `src/config/loader.ts` | 2 | Unused import | `execSync` from `child_process` — only consumer is the dead `detectProjectInfo` function. | Delete |
| 5 | `src/pipeline/states.ts` | 58 | Dead feature flag | Migration comment `// --- New stage-based API (coexists with labels during migration) ---` — migration is complete; comment is misleading and should be removed along with the label block above it. | Delete |

## Needs Review

Items that are not clearly safe to delete — medium/low confidence, exported-only-for-tests, public API surface, or potential dynamic usage. Include a short note explaining what to verify or why it might be kept.

| # | File | Line | Type | Why it appears dead | Confidence | Note |
|---|------|------|------|---------------------|------------|------|
| 1 | `src/utils/links.ts` | 1–10 | Unused module | `buildShareLink` is the sole export; never imported in any `src/` file — only in tests. Appears to be a planned feature (GitHub edit links) that was never wired up. | Medium | Verify whether share-link feature is on roadmap; if not, delete entire file and test. |
| 2 | `src/pipeline/machine.ts` | 29–31 | Unused export | `hasHandler` — exported but never imported in `src/`; only used in tests. | Medium | Kept for testability. Consider removing export if tests can use `dispatch` instead. |
| 3 | `src/git/operations.ts` | 72–74 | Unused export | `getCurrentBranch` — never imported in `src/`; only used in tests. | Medium | Utility kept for test convenience. Verify no planned usage. |
| 4 | `src/git/operations.ts` | 76–82 | Unused export | `branchExists` — never imported in `src/`; only used in tests. Logic already exists inline in `checkoutBranch` (line 14). | Medium | Duplicates logic in `checkoutBranch`. Consider consolidating. |
| 5 | `src/git/operations.ts` | 21–27 | Unused export | `SecretDetectedError` class export — class is instantiated internally by `commitAll` (line 53) but the export is never imported. Callers catch generic `Error`. | Medium | The export is dead but the class itself is used. Remove `export` keyword only. |
| 6 | `src/git/secrets.ts` | 25–33 | Unused export | `checkFileName` — used internally by `scanFiles` (line 56) but export is never imported in `src/`; only tests. | Medium | Remove `export` keyword; function is used internally via `scanFiles`. |
| 7 | `src/git/secrets.ts` | 35–51 | Unused export | `checkFileContent` — used internally by `scanFiles` (line 61) but export is never imported in `src/`; only tests. | Medium | Remove `export` keyword; function is used internally via `scanFiles`. |
| 8 | `src/state/store.ts` | 15 | Unused export | `writeState` — used internally by `updateStage` and `setError` in the same file, but export is never imported in `src/`; only tests. | Medium | Remove `export` keyword; function is used internally. |
| 9 | `src/pipeline/validation.ts` | 16 | Unused export | `validateAnswersFromString` — used internally by `validateAnswers` (line 13) but export is never imported in `src/`; only tests. | Medium | Remove `export` keyword; function is used internally. |
| 10 | `src/pipeline/validation.ts` | 4–7 | Unused export | `ValidationResult` type — return type of `validateAnswers`/`validateAnswersFromString` but never explicitly imported anywhere (TypeScript infers it). | Low | Removing export is safe; interface documents the shape for test authors. |
| 11 | `src/state/plan-folder.ts` | 8–16 | Unused export | `CreatePlanOptions` interface — never imported anywhere, not even tests. Consumers pass object literals. | Medium | Remove `export` keyword or delete if only used for the function parameter. |
| 12 | `src/state/plan-folder.ts` | 18–22 | Unused export | `CreatedPlan` interface — never imported anywhere, not even tests. Return type inferred by callers. | Medium | Remove `export` keyword. |
| 13 | `src/state/advancement.ts` | 13–16 | Unused export | `AdvancementResult` interface — never imported anywhere, not even tests. Return type inferred by callers. | Medium | Remove `export` keyword. |
| 14 | `src/claude/fasten.ts` | 5–8 | Unused export | `FastenAnalysisResult` interface — never imported anywhere, not even tests. Return type inferred by callers. | Medium | Remove `export` keyword. |
| 15 | `src/pipeline/machine.ts` | 10 | Unused export | `HandlerFn` type — never imported anywhere, not even tests. Only used internally in `HANDLERS` record type. | Medium | Remove `export` keyword. |

# Complete

- [x] Ready to advance to Plan Questions
