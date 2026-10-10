# Design Questions for #6: drive-enforcements

> **Role**: Senior Software Architect
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-10-10

---

The product decisions are settled in `01_product.md` — the verb list and its false positives, no
overrides anywhere, plan-text-only dependency detection, refuse on a dirty tree, one task per
`drive`, leave the operator on the task branch, no warn-only period, Milestone 0 ships alone.

These six questions are the ones whose answers most constrain the implementation. Detail questions
(message wording, individual rule cases, doc line edits) are deliberately left for the plan lap.

## Enforcement mechanics — Milestone 0

### Q1: How does the guard's decision logic get to the SDK's hook, and does `canUseTool` survive?

`createToolGuard` currently *is* a `CanUseTool`: the rule body and the SDK's callback signature are
the same function. The product requires those rules to run as a `PreToolUse` hook instead, with the
rules unchanged in substance. Do we rewrite `createToolGuard` in the hook's shape, or split it? And
do we keep passing `canUseTool` alongside the hook as a belt-and-braces measure?

**Answer:**
Split it, and **drop `canUseTool` entirely**.

Extract the rule body into a transport-neutral decision function in `src/claude/guard.ts`:

```
decideToolCall(options: GuardOptions): (toolName: string, input: Record<string, unknown>) => GuardDecision
type GuardDecision = { behavior: "allow" } | { behavior: "deny"; reason: string; message: string }
```

Every rule (0, 1, 2, 3, 4a, 4b, 5, the `Skill` allowance, the internal-error fail-closed branch)
moves across byte-for-byte, including the audit write and the `log.warn`. `GuardDecision` is our
type, not the SDK's — that is the whole point of the split.

Then one thin adapter, `createGuardHook(options)`, maps `GuardDecision` onto the SDK's `PreToolUse`
output (`{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
permissionDecisionReason: message } }`), registered in `runAndStream` as
`hooks: { PreToolUse: [{ hooks: [guardHook] }] }` with **no matcher**, so it sees every tool call
including ones outside the lap's list.

`canUseTool` goes, and not for tidiness: **keeping it is incompatible with the product's
refuse-to-start signal.** The SDK emits `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` whenever `canUseTool` is
passed under `bypassPermissions`, and `01_product.md` §3.3 makes that warning a hard stop. Pass
both and every session refuses itself. Dropping it also removes the "which one actually ran?"
ambiguity that made this bug survive two releases, and turns the warning into a permanent canary:
if it ever fires again, someone reintroduced the shadowed wiring.

Keep the existing `CanUseTool`-shaped export only if a test needs it, and if so name it
`__testOnlyCanUseToolAdapter` so nobody wires it into a session by accident. My recommendation is
to delete it and adapt the existing rule tests to call `decideToolCall` directly — they are
testing rules, not transports.

### Q2: How does the lap's tool list become a restriction, and can a settings file re-grant it?

`allowedTools` is an auto-approve list, not a filter — the probes showed a review session with
`allowedTools: ["Read","Glob","Grep"]` happily running `Write` and `Bash`. The product requires a
tool outside the lap's list to be denied. Hook default-deny, context removal, or both? And does
`settingSources: ["project", "user"]` let a project or user settings file grant back what the lap
withholds?

**Answer:**
**The hook is the authority; context narrowing is an optimisation on top.**

1. **Default-deny in the hook.** `GuardOptions` gains `allowedTools: string[]`, and
   `decideToolCall` grows one rule that runs *before* all the others: a tool not in that list (plus
   `Skill`, when the lap resolved skills) is denied with reason `"tool not available at this
   stage"` and audited like any other denial. This is the only mechanism `01_product.md` AC0.4
   depends on, so it is the only one that must work.
2. **Context narrowing as a turn-budget measure, not a security measure.** Also set
   `disallowedTools` to the complement of the lap's list, computed from a single
   `BUILTIN_TOOLS` constant in `skills.ts` so the two cannot drift. Its job is to stop the model
   wasting turns reaching for tools the hook will deny — the denial message goes back to the model
   and it retries, which is expensive at review stages with tight `max_turns`. If the SDK version
   in range turns out to remove those tools from context, that is a bonus, not a requirement, and
   **no test may assert security on it.**
3. **`settingSources` stays `["project", "user"]`** — the skill-resolution probe needs it — and the
   question gets settled by test, not by reasoning: a test (ideally in the live suite, Q6 tier 3)
   puts a project `settings.json` with `permissions.allow: ["Bash"]` into a scratch directory and
   asserts `Bash` is still denied at a review stage. A `PreToolUse` hook deny is expected to
   outrank an allow rule; if it does not, the fallback is to drop `"project"` from `settingSources`
   for plan-jailed stages and resolve skills in the separate zero-turn probe session
   `runAndStream` already runs. Record whichever is true as a Key decision — this is exactly the
   class of assumption that produced Milestone 0.

### Q3: How does `drive` know enforcement is actually installed, so §3.3's refusal is a fact?

The product refuses to start a lap it cannot guard. With `canUseTool` gone (Q1), the shadow warning
no longer fires, so it cannot be the detector for the normal case. What is?

**Answer:**
Three layers, two before the session and one during it. None of them costs a paid turn.

**Pre-flight, in `runAndStream` before `query`:**

1. **A declared supported SDK range.** `package.json` pins `@anthropic-ai/claude-agent-sdk` to a
   range we have probed, and a new `src/claude/capability.ts` reads the installed version at
   session start and compares it against a `GUARD_VERIFIED_RANGE` constant that carries a dated
   comment naming the probe. Outside the range → the §3.3 refusal, naming the installed version and
   the verified range. This is blunt on purpose: an unverified SDK is exactly the situation that
   produced this bug, and the cost of being wrong is one range bump plus a re-probe.
2. **A fatal warning listener.** `process.on("warning")` for the lifetime of the session: any
   warning whose code starts `CLAUDE_SDK_` and names a shadowed or ignored callback aborts the
   session and fails the lap with the §3.3 message. Cheap, and it is the one signal that told the
   truth in October.

**In-flight, the part that catches a silent regression on the first real session:**

3. **A hook heartbeat.** `createGuardHook` records that it was invoked. `runAndStream` already
   consumes the message stream, so it also counts observed `tool_use` blocks. At session end,
   `toolUseCount > 0 && hookInvocations === 0` is a hard error — the lap goes to `error` with
   "the guard was not consulted on any of N tool calls", not a warning. A session that made no
   tool calls proves nothing and passes silently.

The `Guard:` banner and `init`'s security line are printed **after** layers 1 and 2 pass, which is
what makes `01_product.md` AC0.8 structural rather than a promise: the only code path that prints
the banner is the one that installed the hook.

Explicitly **not** recommended: a canary session that asks the model to call a denied tool. It is a
paid session, and layers 1–3 cover the same ground for free.

## The forbidden-action check — Milestone 1

### Q4: Where does the forbidden-verb list live, and what does a match look like?

Three consumers need the same list: `signOffPlaybook` (refuses the tick), the plan prompt (teaches
the rule and the verification phrasings), and the AC1.3 test (asserts no prompt or spec contains a
forbidden verb in a gate example). A list copied into three places is a list that will disagree
with itself by the next task.

**Answer:**
A new leaf module, `src/pipeline/forbidden-actions.ts`, following the discipline `markdown-scan.ts`
already established: **it imports only `markdown-scan.ts`**, so it can be interpolated into prompts
without a cycle, exactly as `execute-table.ts` can.

```
FORBIDDEN_ACTIONS: { id, pattern: RegExp, label: string }[]   // merge, push, open/create/close a PR,
                                                              // tag, release, deploy, publish,
                                                              // git push, gh pr create|merge,
                                                              // gh release, gh workflow run
VERIFICATION_VERBS: string[]                                  // confirm, check, verify, inspect

type ForbiddenMatch = {
  source: "execute-table" | "gates-section" | "plan-gate";
  rowId?: string;          // G1
  subject: string;         // the row name or checklist item, verbatim
  actionId: string;        // which FORBIDDEN_ACTIONS entry hit
  line: number;            // 1-based, in the file it came from
}

findForbiddenActions(text: string, source: ForbiddenMatch["source"]): ForbiddenMatch[]
describeForbiddenActions(matches: ForbiddenMatch[]): string[]   // the refusal lines, with the rewrite hint
FORBIDDEN_ACTION_SPEC: string                                   // the prose the plan prompt interpolates
```

Two properties that matter more than the names:

- **`FORBIDDEN_ACTION_SPEC` is built FROM `FORBIDDEN_ACTIONS` and `VERIFICATION_VERBS`**, never a
  hand-written copy — the same rule `EXECUTION_TABLE_SPEC` follows with its status and owner
  unions. Adding a verb changes the prompt, the refusal and the test in one edit.
- **Scanning goes through `scanLines`/`isHeading`/`isLive`**, so a fenced or `> `-quoted example is
  inert here exactly as it is to both table readers (AC1.5). Per `CLAUDE.md`, this makes
  `forbidden-actions.ts` a third consumer of `markdown-scan.ts`: any change to that module now
  requires the four-playbook equivalence check **plus** this module's cases.

`signOffPlaybook` calls it twice — once over the parsed table's operator rows and the
`## Operator gates in this plan` section of `04_execute.md`, once over `03_plan.md`'s `## G<n>`
headings and checklists — and keeps the existing degradation contract: an unparsable table warns
and allows, while the `03_plan.md` scan runs regardless (AC1.7). Keep it a separate function from
`trailingOperatorRows`; they answer different questions (position vs content) and the product keeps
them as two distinct checks with two distinct messages.

## `drive`'s branch orchestration — Milestone 3

### Q5: How does `drive` read a task's tick from that task's branch without moving the working tree?

The ordering problem is real: a task's tick can only be seen on its branch, the candidate set needs
the ticks, and the branch switch needs a clean tree and a *chosen* task. Checking out every task
branch in turn to look is out — it moves the operator's tree before they have agreed to anything.

**Answer:**
Read other branches with `git show`, read the current branch from disk, and only ever check out the
one task that was selected.

1. **`src/git/operations.ts`** gains
   `readFileAtBranch(git, branch, repoRelPath): Promise<string | null>` — a thin
   `git.show` of `<branch>:<path>`, with `null` on "does not exist in branch" and a thrown error on
   anything else. Read-only, no index, no tree movement.
2. **`src/state/discovery.ts`** keeps listing plan folders from the working tree (folder names are
   shared across branches), and gains a per-task resolution step that chooses its source:
   - **the task's branch is the current branch → read from disk.** Non-negotiable: the operator's
     tick is usually *uncommitted* on the branch they are standing on, and `git show` would miss
     it. This is the common "edit a plan file and drive" loop.
   - **the branch exists and is not current → `readFileAtBranch`** for `state.yml` and the stage's
     questions file.
   - **the branch does not exist yet → read from disk** (first `drive` of a task).
3. **A new `src/state/actionable.ts`** turns that into the candidate set defined in
   `01_product.md` §7.2 step 2 — agent stage, or human stage with its `(file, markerText)` pair
   ticked, or `error` under `--retry` — reusing the existing marker readers so "ticked" means
   exactly what `tryAdvance` means by it. `drive` and `pitwall` both want this; give it a home
   outside `drive.ts` from the start.
4. **`driveCommand` becomes the §7.2 sequence as named steps** — `buildCandidates`, `selectTask`,
   `ensureBranch`, `advanceSelected`, `dispatch`, `report` — replacing today's advance-everything
   loop. `ensureBranch` owns the dirty-tree policy: `git.status()`, and if the selected task's
   branch differs from `currentBranch`, refuse when `!status.isClean()`, listing `status.files` in
   git's own `XY path` shape (AC3.3); when the branch is already current it does not look at the
   tree at all (AC3.4).
5. **`advanceSelected` runs `tryAdvance` for the selected task only**, after the checkout. This is
   the behavioural change the design spec must call out: a ticked task that is not selected does
   not advance this run. It is named in the "Also actionable" line and advances on its own `drive`,
   which is what makes one-task-per-run honest rather than a lap silently skipped.

Write both policy decisions and their reasoning into `02_design.md` — AC3.8 asks for the reasoning,
not just the choice.

## Testing the thing that was untested

### Q6: What test architecture proves the wiring, and where does the live-SDK check live?

`tests/claude/session.test.ts` passed for two releases while enforcing nothing: it pulled
`canUseTool` out of the options and called it by hand. The product requires a test that would have
caught that, plus the pre-release dry run of every lap. What is the shape?

**Answer:**
Three tiers, and the rule that **no tier may prove a rule by calling it directly**.

**Tier 1 — rules (fast, existing).** `decideToolCall` keeps the current rule table tests, plus the
new cases: default-deny for a tool outside the lap's list, the five `ready_to_execute` denials, and
the three read-only allowances (`git fetch`, `gh pr view`, `gh pr list`) asserted as explicitly as
the denials (AC2.1, AC2.2) — that allowance test is the one protecting every plan with a gate.

**Tier 2 — wiring (fast, new, this is the test that was missing).** With `query` mocked, capture the
options object and assert, on the object itself:

- `options.hooks.PreToolUse` exists and contains the guard callback;
- `options.canUseTool` is **absent** — the assertion that fails if anyone reintroduces the shadowed
  wiring (AC0.6);
- the captured hook, invoked with the SDK's real `PreToolUse` input shape, returns the deny output
  shape for a tool outside the lap's list and for a review-stage `Bash`;
- the heartbeat contract from Q3.3: a simulated stream with `tool_use` blocks and zero hook
  invocations fails the lap.

**Tier 3 — live SDK (opt-in).** A `tests/live/` directory excluded from `npm run test` by a second
project in `vitest.config.ts`, run by `npm run test:live` against a real key, mirroring the
objective's three probes in a scratch directory with `settingSources: []`: the hook denies a
`Write`; a tool outside the lap's list is denied; no session emits
`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`. Plus the Q2.3 settings-re-grant probe. It runs in CI only when
`ANTHROPIC_API_KEY` is present; where it cannot, the objective's fallback applies and it becomes a
named manual step in the release checklist. Do not let tier 3's optionality weaken tiers 1–2 —
AC0.1–AC0.4 are satisfied by the §3.4 dry run as evidence, and tiers 1–2 are what keep them true.

**Globally:** a vitest setup file installs `process.on("warning")` and fails the run on any
`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` (AC0.5), so the warning can never again be something that
scrolls past.

**The pre-release dry run (`01_product.md` §3.4) is an artefact, not a vibe.** Each of the seven
laps is run once against a throwaway task with the guard live, and the resulting
`.vibe-racer/audit.log` plus a per-lap verdict — denial correct and prompt fixed, or rule wrong and
fixed as a recorded decision — is written into this task's `05_qa.md`. That record is what AC0.9 is
checked against.

# Complete

- [ ] Ready to advance to Design Review
