# skills-draft — engineering commands → skills

Recipe for converting the org's `engineering:*` slash commands into Claude Code skills that
vibe-racer's laps can actually invoke.

**This directory holds the converter and this note only.** The ten generated `SKILL.md` files
are deliberately not committed — they are operator-specific, they live in `~/.claude/skills/`,
and a stale copy in the repo would drift from the installed one. Regenerate when needed.

## Status

Converted, installed, and probe-verified on 2026-08-24. All ten resolve via
`supportedCommands()` under `settingSources: ["project", "user"]` (28 commands vs 17 without).

Fidelity was checked mechanically — no content passed through an LLM:

| check | result |
|---|---|
| `name:` frontmatter added | 10/10 |
| `description:` preserved byte-for-byte | 10/10 |
| `argument-hint:` removed | 10/10 |
| no `$ARGUMENTS` left in body | 10/10 |
| every non-`$ARGUMENTS` source line survives verbatim | 10/10 |
| resolves via `supportedCommands()` | 10/10 |

## Regenerate

```bash
unzip -q ~/Downloads/engineering-commands*.zip -d /tmp/eng
python3 convert.py /tmp/eng/.claude/commands /tmp/eng-skills

mkdir -p ~/.claude/skills
cd /tmp/eng-skills && for d in */; do cp -r "${d%/}" ~/.claude/skills/; done
```

Then rename `debug` → `eng-debug` (see below), or the collision returns.

> **`cp` footgun:** `cp -r src/*/ dest/` *with* the trailing slash copies each directory's
> *contents*, silently flattening all ten into a single `SKILL.md`. Use the loop above.

## Why skills, not commands

The archive ships **custom slash commands** (`argument-hint:`, `$ARGUMENTS`, bare `.md`).
Slash commands are expanded client-side when a human types `/name`. vibe-racer's laps are
headless SDK sessions — nobody types anything — so the `Skill` tool cannot invoke them.

They *would* still appear in `supportedCommands()`, which makes installing them as commands
the worst of the three outcomes: `partitionSkills` marks them available, AC7's missing-skill
warning never fires, and `buildSkillsSection` advertises ten skills the agent cannot call.
A silent broken promise is worse than a loud missing one.

Skills (`~/.claude/skills/<name>/SKILL.md`) are the `Skill` tool's native format. Verified
with a canary: invisible under `settingSources: ["project"]`, visible under
`["project", "user"]` — which is what M4 changes.

## The `debug` collision — read before adding more skills

The original `debug` **shadowed the bundled `debug` command**. The probe returned two entries
with the same name:

```
entries: 28   unique names: 27   duplicates: debug x2
  [0] "Enable debug logging for this session and help diagnose issues (bundled)"
  [1] "Structured debugging session - reproduce, isolate, diagnose, and fix..."
```

Worse than a missing skill. `partitionSkills` builds a `Map` keyed on name, which silently
keeps the last entry — so the advertised description depends on iteration order, which one
the `Skill` tool invokes is undefined, and **no warning fires, because the name resolves**.

Renamed `debug` → `eng-debug`: 28 entries, 28 unique, no duplicates.

This fed back into `03_plan.md` M4 — `partitionSkills` now returns an `ambiguous` list and
`runAndStream` logs a collision warning telling the operator to rename.

**Bundled names to avoid when adding local skills:** `batch, claude-api, compact, context,
cost, debug, extra-usage, heapdump, init, insights, loop, review, schedule, security-review,
simplify, team-onboarding, update-config`.

## Still unverified

Resolving in `supportedCommands()` proves a skill is **visible**, not **invocable**. Whether
the `Skill` tool can actually call a user-scope skill inside a lap has not been tested — that
needs one real session. **Do not trust any of these in a lap prompt until it is.**

## Config

Not `DEFAULT_SKILLS` — that is bundled-only, because vibe-racer runs with `cwd` set to the
host project and can neither ship nor guarantee anything under `~/.claude/`. These belong in
this repo's `.vibe-racer.yml`:

```yaml
skills:
  design:   ["system-design", "architecture"]
  plan:     ["testing-strategy", "architecture"]
  execute:  ["simplify", "eng-debug"]
  qa:       ["security-review", "code-review", "tech-debt"]
  decision: ["deploy-checklist", "documentation"]
```

Note `eng-debug`, not `debug`.

`standup` and `incident-response` have no lap that wants them.

**Do not add this block until M4 lands** — the `skills` key does not exist in the config
schema yet. zod strips unknown keys rather than erroring, so adding it early is harmless but
inert, and inert config invites the assumption that it is working.
