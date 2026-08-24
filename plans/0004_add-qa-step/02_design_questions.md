# Design Questions for #4: Add QA step

> **Role**: Senior Software Architect
> **Stage**: `ai_product_review` → `need_design`
> **Date**: 2026-08-24

---

## Stage insertion and guard treatment

### Q1: How should `ai_qa` be classified in the guard system — new category, or augmented review stage?

`ai_qa` needs plan-directory write jailing (like review stages) but also needs `Bash` (unlike review stages, which block it). Today `REVIEW_STAGES` is a flat set that `canUseTool` checks for both jailing and Bash blocking. Adding `ai_qa` to it would require splitting those two concerns apart. The alternative is giving `ai_qa` its own guard branch entirely.

**Answer:**
Split `REVIEW_STAGES` into two orthogonal sets: `PLAN_JAILED_STAGES` (stages whose file writes are restricted to the plan directory) and `BASH_BLOCKED_STAGES` (stages that cannot run Bash). `ai_qa` joins `PLAN_JAILED_STAGES` but not `BASH_BLOCKED_STAGES`. This avoids a one-off `if (stage === 'ai_qa')` branch in the guard and makes the policy composable for future stages. The existing review stages join both sets, so their behavior is unchanged. `formatGuardSummary` reads from these sets instead of `REVIEW_STAGES`, so it prints accurate tool availability per stage.

---

### Q2: Where in `STAGE_ORDER` and the handler dispatch map do `ai_qa` and `need_decision` land, and what is the handler module structure?

The product spec defines the logical position. The architecture question is whether QA gets its own handler file (`qa.ts`) or is folded into an existing handler, and how `need_decision` integrates with the existing `done` transition.

**Answer:**
Create `src/pipeline/handlers/qa.ts` for `ai_qa` — it has its own prompt, its own guard profile, and its own output file, so it deserves its own handler. `need_decision` is a pit-stop stage (human ticks a checkbox), so it needs no new handler file — it uses the same `tryAdvance` path as every other `need_*` stage, with the added checklist-enforcement rule in `validation.ts`. The handler dispatch map in `drive.ts` gets one new entry: `ai_qa → handleQa`. `cleanup_ready`'s existing handler is extended to also produce `06_decision.md` after its current work (docs pass, build/lint/test).

---

## Checklist enforcement

### Q3: How should `validation.ts` enforce the "all checkboxes ticked" rule for `need_decision` without affecting other stages?

`tryAdvance` currently checks two things: the completion marker checkbox and that all `**Answer:**` blocks are filled. For `need_decision`, it must additionally verify that every `- [ ]` in `06_decision.md` is ticked. This rule should only apply to the decision stage, and it needs to distinguish the completion marker checkbox from the checklist items above it.

**Answer:**
Add a `validateDecisionChecklist(filePath: string)` function in `validation.ts` that scans the file for any unchecked `- [ ]` lines (excluding the completion marker line, which `removeCompletionMarker` already identifies). Call it from `tryAdvance` only when the current stage is `need_decision`. Return a validation error with the count of unticked items so `drive` can print a useful message like `"3 checklist items still unticked in 06_decision.md"`. This keeps the rule isolated — no other stage calls this function, and no existing validation logic changes.

---

## Prompt design

### Q4: How should the QA prompt be structured to produce honest negative findings rather than agreeable summaries?

The product spec identifies this as a first-class prompt-design problem. The model's default behavior is to be agreeable and summarize positively. The QA prompt needs to actively counteract this. The architecture question is what prompt techniques and structural constraints to use.

**Answer:**
Structure the QA prompt with three mechanisms: (1) **Mandatory sections** — the prompt requires `05_qa.md` to have all six sections (What works, What doesn't, What regressed, Deviations, Risks, Verification run) and states that empty "What doesn't" or "What regressed" sections must contain an explicit `No issues found — verified by [specific evidence]` rather than being omitted. (2) **Adversarial framing** — the persona is a QA engineer whose job performance is measured by finding real issues, not by confirming the build passes. The prompt should say: "A QA report that finds nothing wrong is a red flag, not a success — it means you didn't look hard enough or you're being agreeable." (3) **Evidence requirement** — every claim (positive or negative) must include the command run and its output. No summarizing test results; paste them. This makes it mechanically harder to fabricate a clean report. The prompt loads `03_plan.md` for acceptance criteria and `04_execute.md` for what was claimed done, so the QA session cross-references claims against evidence.

---

## Skills integration

### Q5: How should per-lap skill configuration flow from `.vibe-racer.yml` through the session builder to the prompt?

Skills need to be (a) read from config with per-lap defaults, (b) validated against what's actually installed, (c) injected into the prompt, and (d) degraded gracefully when missing. The architecture question is where each of these steps lives and how they compose.

**Answer:**
Add a `src/claude/skills.ts` module with two exports: `resolveSkills(lap: string, config: VibeRacerConfig)` which merges built-in defaults with config overrides for a given lap, and `validateSkills(names: string[])` which checks each skill name against the operator's installed skills (via the Claude Code SDK's skill discovery, or by attempting to reference them and catching failures). `resolveSkills` returns a `{ available: string[], missing: string[] }` tuple. The session builder in `session.ts` calls `resolveSkills`, logs warnings for `missing`, and passes `available` to the prompt builder. The prompt builder in `prompts.ts` appends a "Available engineering skills" section to the system prompt listing the skill names and a one-line description of when to use each. `settingSources` changes from `["project"]` to `["project", "user"]` to make account-level skills visible. `Skill` is added to every handler's `ALLOWED_TOOLS`. The guard makes an explicit allow decision for `Skill` calls rather than falling through to default-allow.

---

## Trivial fast-path re-plumbing

### Q6: What artifact should the agent produce to signal triviality, and how does the handler detect and act on it?

The guard now denies agent writes to `state.yml`, so the current mechanism (agent writes `trivial: true` to `state.yml`) is dead. The objective notes that writing `03_plan_questions.md` instead of `01_product_questions.md` is already an unambiguous signal. The architecture question is whether to use this file-presence signal or something else, and how `objective-review.ts` detects it.

**Answer:**
Use file presence as the signal. The objective-review prompt instructs the agent: "If you determine this task is trivial, write `03_plan_questions.md` directly instead of `01_product_questions.md`." After the session completes, `objective-review.ts` checks which file was created. If `03_plan_questions.md` exists and `01_product_questions.md` does not, the handler calls `writeState({ ...state, trivial: true })` and advances to `need_plan` instead of `need_product`. This is already how the handler infers the agent's intent — it just moves the `trivial: true` write from the agent to the handler. No new artifact format, no new protocol. The prompt change is minimal: remove the "write state.yml" instruction, keep the "write 03_plan_questions.md" instruction.

---

# Complete

- [ ] Ready to advance to Design Review
