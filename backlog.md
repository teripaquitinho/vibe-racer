# Backlog

Prioritized roadmap for vibe-racer. Items are grouped by theme and ordered by impact.

---

## North Star: Wiki UI for Multi-Project Visibility

### Local Web Dashboard

Build a local web UI to visualize pipeline status across multiple projects. This is the single most impactful feature for making vibe-racer a complete product — without it, multi-project visibility requires running `vibe-racer pitwall` manually in each repo.

**Scope:**

- Task board view with lap progress and document previews
- Cross-project pit wall for teams running vibe-racer across multiple repos
- Lightweight local server (Express/Fastify) + modern frontend (React or Svelte)
- Purpose-built, self-hosted interface — no third-party SaaS dependency
- Read-only initially; checkbox-ticking and task creation in a later iteration

---

## AI and Pipeline Improvements

### Bootstrap New Project Boost

The very first lap of a brand-new project is structurally different from a regular race — there is no prior context, no existing code, no conventions to honor. Add a dedicated bootstrap mode that handles initial-plan creation with a different prompt and question set than the standard objective lap.

### Bull/Bear Debate at Each Lap

Use a bull/bear debate pattern to stress-test answers at every lap: one persona argues for the proposed answer, another argues against. Forces the race engineer to surface assumptions and edge cases instead of accepting the first plausible response.

### AgentOps / Evaluation Metrics

Track goal completion rate, lap success/failure ratios, and session trajectory logging. Compare expected vs. actual tool call sequences per lap to identify quality regressions. *(Source: Kaggle Agents Companion whitepaper)*

### Evaluator-Optimizer Pattern

Add a second-pass evaluation agent that validates lap output quality before committing. One agent generates, another evaluates — catching gaps before the pit stop. *(Source: Anthropic, "Building Effective Agents")*

### Prompt Versioning

Track prompt template versions alongside model, temperature, and output quality results. Enable iterative refinement of the 6 prompt templates based on measurable outcomes. *(Source: Google Prompt Engineering whitepaper)*

### Human Feedback Instrumentation

Simple thumbs-up/down per lap output to build a feedback signal for prompt refinement. Low friction for the user, high value for continuous improvement.

### Few-Shot Examples in Prompts

Add example question-answer pairs to lap prompts to demonstrate expected quality and format. Reduces variance in race engineer output quality.

### Automatic Prompt Engineering (APE)

Use LLMs to generate and evaluate prompt variants over time. Requires evaluation metrics infrastructure first. *(Source: Google Prompt Engineering whitepaper)*

### Multi-Agent Patterns

Evaluate diamond (rephraser) and hierarchical coordination patterns for quality improvement. Currently single-agent per lap is correct per industry guidance — revisit when evaluation metrics exist to measure improvement. *(Source: Kaggle Agents Companion)*

### Structured Follow-Up Schemas

Replace appended markdown follow-ups with typed follow-up structures. Formalize the "contract negotiation" pattern — precise deliverables, validation mechanisms, and explicit underspecification flagging.

---

## Git Workflow

### Checkout `main` Before Creating a New Branch

`vibe-racer new` should ensure the working tree is on `main` (and up to date) before branching, so new tasks never accidentally fork off another in-progress branch.

### Reuse Existing Branch When Resuming a Task

If a branch for the task already exists locally, check it out instead of erroring. Lets users pause and resume tasks across sessions without manual git gymnastics.

---

## Internationalization

### Multi-Language Plan Documents

Allow plan documents to be rendered in a configurable language, so non-English teams can review pit-stop docs in their native language without translating manually.

---

## Infrastructure and Tooling

### Docker Sandbox Mode

First-class `--sandbox` flag that runs vibe-racer inside Docker with `--network none`. Priority for teams working with sensitive codebases where network isolation is required.

### Dead Code Scanning Utility

Bundled command (or maintenance recipe) that runs a dead-code analysis on the host project. Goal: identify code that can be safely removed.

**What to look for:**

1. **Unused exports** — functions, classes, constants, or types that are exported but never imported anywhere in the project.
2. **Unreachable code** — code after unconditional returns, throws, or in branches that can never be true (e.g., `if (false)`, contradictory conditions).
3. **Unused variables and imports** — locally declared variables or imported modules that are never referenced.
4. **Dead feature flags / disabled blocks** — hardcoded flags or config values that permanently disable a code path.
5. **Unused files/modules** — entire files that are never imported or required anywhere in the codebase.
6. **Deprecated internal APIs** — functions or modules that were replaced elsewhere but never deleted.

**For each finding, report:**

- File path and line number
- Why it appears dead
- Confidence level (high / medium / low) — low confidence means there could be dynamic usage (reflection, string-based requires, external consumers)
- Recommended action: delete, consolidate, or investigate further

End with a prioritized summary grouped by: safe to delete / needs review / keep but flag. Analysis only — no automatic edits.

---

## Community

### Community Infrastructure

- Issue templates (bug report, feature request)
- PR template
- GitHub Discussions
- Add when community activity warrants — don't create bureaucracy before contributors
