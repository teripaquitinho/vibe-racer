# vibe-racer fix handoff

**Target repo:** `~/Projects/scuderia/vibe-racer` (linked as `vibe-racer@0.2.0`)
**Found via:** mosaic task #5 (`plans/0005_dashboard-display-planning`), 2026-07-21
**Status:** mosaic side already repaired; vibe-racer side untouched.

---

## Symptom

`design-review` handler aborted with a zod `invalid_value` dump on `path: ["next"]`, then
immediately failed a second time with `Failed to save error state` and printed the identical
dump again.

```
[vibe-racer] Handler [design-review] failed: [ { code: "invalid_value", path: ["next"], ... } ]
Partial work committed
[vibe-racer] Failed to save error state
[vibe-racer] [ { code: "invalid_value", path: ["next"], ... } ]
```

The rejected value was `next: ai_plan`. The valid stage name is `ai_plan_review`; there is no
bare `ai_plan` in the enum.

---

## Root cause

**The review agent wrote `state.yml` itself.** The state machine never produced the bad value.

`next` is computed, never authored — `src/state/store.ts`:

```ts
// writeState()
next = nextStage(state.stage);   // need_plan -> ai_plan_review
```

`nextStage` indexes `STAGE_ORDER`, so `need_plan` can only ever yield `ai_plan_review`.
`design-review.ts` likewise passes only typed `Stage` literals (`stageOnSuccess: "need_plan"`).
Neither can emit `ai_plan`. Confirmed: `grep -rn "ai_plan" src` returns only `ai_plan_review`.

Git evidence — commit `7d58c98` "vibe-racer: partial work (error) for #5":

```diff
-updated: 2026-07-21T07:11:57.414Z
-prev: ai_product_review
-next: ai_design_review
+updated: 2026-07-21T08:15:00.000Z
+prev: ai_design_review
+next: ai_plan
```

Every genuine `writeState` call stamps `new Date().toISOString()` and leaves real millisecond
precision — `07:11:57.414Z`, `06:50:44.056Z`, `12:49:05.312Z`. The corrupt write is
`08:15:00.000Z`: a round, hand-authored timestamp. That write did not come from `writeState`.

### Why the guard allowed it

`src/claude/guard.ts` Rule 4 jails review-stage writes to the task plan directory:

```ts
if ((toolName === "Write" || toolName === "Edit") && REVIEW_STAGES.has(stage)) {
  const planDir = resolve(cwd, taskPlanPath) + sep;
  if (!resolved.startsWith(planDir) && resolved !== resolve(cwd, taskPlanPath)) {
    return deny(toolName, rawPath, `review stage: writes restricted to ${taskPlanPath}/`);
  }
}
```

`state.yml` **lives inside that directory**, and `Write` is in `review-runner.ts`'s
`ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write"]`. So the pipeline's own control file sits
inside the agent's write sandbox. The agent advanced the stage on its own, guessed the field
values, and got the enum wrong. `review-runner` then called `updateStage` → `readState` →
`stateSchema.parse` → throw.

### Why the error message printed twice

`setError` also begins with `readState`:

```ts
export function setError(planPath, errorStage, message) {
  const state = readState(planPath);   // <-- re-reads the same poisoned file
  writeState(planPath, { ...state, stage: "error", ... });
}
```

The recovery path is taken out by the exact corruption it is trying to record. Hence
`Failed to save error state` followed by a repeat of the original dump.

---

## Fixes

### 1. Deny agent writes to `state.yml` (primary — closes the hole)

`src/claude/guard.ts`, inside the `PATH_TOOLS` block. Put it **before** Rule 4 so it applies at
every stage, not just review stages — execution stages have `Write`/`Edit` too.

```ts
// Rule 3.5: state.yml is pipeline-owned, never agent-writable
if (toolName === "Write" || toolName === "Edit") {
  if (basename(resolved) === "state.yml") {
    return deny(toolName, rawPath, "state.yml is owned by the pipeline");
  }
}
```

`basename` is already imported. Consider also dropping `Write` from `ALLOWED_TOOLS` in
`review-runner.ts` in favour of `Edit` where the review only amends existing spec files —
but the guard rule is the load-bearing fix, since review rounds legitimately create
`0N_*_questions.md`.

### 2. Make `setError` survive an unparseable state file

`src/state/store.ts`. Do not let recovery depend on the corrupt read.

```ts
export function setError(planPath: string, errorStage: string, message: string): void {
  let state: TaskState;
  try {
    state = readState(planPath);
  } catch {
    // State file is corrupt — that may well be *why* we are here.
    // Reconstruct the minimum viable record rather than throwing.
    const raw = (() => {
      try { return parse(readFileSync(path.join(planPath, STATE_FILE), "utf-8")); }
      catch { return {}; }
    })();
    state = {
      stage: "error",
      title: typeof raw?.title === "string" ? raw.title : basename(planPath),
      created: typeof raw?.created === "string" ? raw.created : new Date().toISOString(),
    } as TaskState;
  }
  writeState(planPath, { ...state, stage: "error", error_stage: errorStage, error_message: message });
}
```

Salvages `title`/`created` when possible, still writes a valid error state when not.

### 3. Validate on write, not just on read

`src/state/store.ts` `writeState` currently serialises unchecked, so bad state surfaces at the
*next* read rather than at the write that caused it — which is what made this hard to trace.

```ts
const updated = stateSchema.parse({ ...state, prev, next, updated: new Date().toISOString() });
writeFileSync(filePath, stringify(updated), "utf-8");
```

Fails loudly at the true origin. Note this alone would **not** have prevented the incident (the
agent bypassed `writeState` entirely) — it is diagnostic hardening, not the fix.

---

## Suggested regression tests

- `guard.ts`: `Write` to `<planPath>/state.yml` is denied at a review stage **and** at an
  execution stage; `Write` to `<planPath>/02_design.md` still allowed at a review stage.
- `store.ts`: `setError` on a plan dir whose `state.yml` has `next: ai_plan` writes a valid
  `stage: error` file instead of throwing.
- `store.ts`: `nextStage("need_plan") === "ai_plan_review"` (guards against enum reordering in
  `STAGES`, since `STAGE_ORDER` is positional).

---

## Already done on the mosaic side

`plans/0005_dashboard-display-planning/state.yml`: `next: ai_plan` → `next: ai_plan_review`.
Task #5 parses again and sits at `need_plan` with `03_plan_questions.md` present.
Tasks #1/#2/#4 are `done` with `next: null`; #3 has no `next` key. No other corruption found.

**Re-run to verify:** the `ai_plan_review` handler on task #5 should now proceed. If the guard
fix lands first, watch for a `Denied: Write .../state.yml` audit entry — that is the fix working,
not a new failure.
