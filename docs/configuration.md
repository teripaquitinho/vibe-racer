# Configuration

## Config File

vibe-racer uses a `.vibe-racer.yml` configuration file created by `vibe-racer init`. The file is searched upward from the current directory.

### Schema

```yaml
# Optional -- GitHub repo URL, enables share links
repo: "https://github.com/owner/repo"

# Directory for plan folders (default: "plans")
plans_dir: "plans"

# Files loaded into Claude's context for every session (default: README.md, CLAUDE.md)
context:
  - README.md
  - CLAUDE.md
  - ARCHITECTURE.md

# Optional -- per-lap Claude Code skills (overrides the defaults below)
skills:
  execute: ["simplify"]
  qa: ["security-review"]
```

### Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `repo` | string (optional) | -- | GitHub repository URL (HTTPS or SSH). Enables share links in generated documents. |
| `plans_dir` | string | `"plans"` | Directory where task plan folders are created. Relative to project root. |
| `context` | string[] | `["README.md", "CLAUDE.md"]` | Files loaded into Claude's context for every session. Use this to give the race engineer project-specific knowledge. |
| `skills` | map of lap -> string[] (optional) | see below | Claude Code skills to make available on each lap. A lap present here replaces its default entirely. |

### Context Files

The `context` array tells vibe-racer which files to include in every Claude Code session. These files help the race engineer understand your project's architecture, conventions, and constraints.

Good candidates for context files:
- `README.md` -- project overview
- `CLAUDE.md` -- AI-specific instructions and project structure
- `ARCHITECTURE.md` -- system architecture documentation
- `docs/api.md` -- API documentation
- Any file that helps the race engineer make better decisions

Files are read relative to the project root. Non-existent files are silently skipped.

## Skills

Each race engineer lap can be given a set of Claude Code skills. The lap is derived from the
stage automatically, so there is nothing to wire up per handler.

| Lap | Stage | Default skills |
|---|---|---|
| `objective` | `ai_objective_review` | none |
| `product` | `ai_product_review` | none |
| `design` | `ai_design_review` | none |
| `plan` | `ai_plan_review` | none |
| `execute` | `ready_to_execute` | `simplify` |
| `qa` | `ai_qa` | `security-review` |
| `decision` | `cleanup_ready` | none |

Override any lap in `.vibe-racer.yml`:

```yaml
skills:
  qa: ["security-review", "my-team-checklist"]
  design: ["architecture"]
```

An entry replaces that lap's default rather than adding to it. Use an empty list to turn a
lap's skills off:

```yaml
skills:
  execute: []
```

### Where skills come from

Skills are resolved from Claude Code itself, not from vibe-racer. Sessions load both
`project` and `user` setting sources, so a lap can use:

- **Project skills** -- `.claude/skills/` in the repo you are racing
- **User skills** -- `~/.claude/skills/`, available in every project
- **Bundled skills** -- whatever ships with your installed Claude Code

| Source | Reachable? | Notes |
|---|---|---|
| Bundled Claude Code skills | always | the only safe basis for the built-in defaults |
| `~/.claude/skills/<name>/SKILL.md` | yes, via `user` scope | the practical way to add your own |
| `<your-project>/.claude/skills/` | yes, via `project` scope | per-project, ships with the repo |
| User-scope plugins (`enabledPlugins`) | yes, if the plugin ships a `skills/` directory | many official plugins ship commands and agents only |
| claude.ai account / org skill catalogues | **no** | Server-side, scoped to a Claude.ai workspace, and reachable from claude.ai, Cowork, and Tag -- not from the CLI or Agent SDK. There is nothing to install locally. To use an equivalent here, re-author it as a local skill under `~/.claude/skills/`. |

vibe-racer probes the session's available commands once and reconciles them with the
requested names:

- A name that isn't found is **skipped with a warning** -- the lap still runs.
- A name that resolves to more than one entry (a project skill shadowing a bundled one) is
  reported as **ambiguous**, so a silent shadow doesn't change behaviour unnoticed.
- If the probe itself fails, the lap **degrades to persona-only** rather than failing.

The probe returns *every* slash command available to the session, not only skills -- harness
commands such as `compact` and `cost` are in that list too. A mistyped name that happens to
collide with one of them resolves silently instead of warning you, so verify a new entry
actually did something on its first lap.

Loading user-scope settings widens the trust boundary — see [Security](/security#setting-sources).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key. Alternatively, use `claude login`. |

## Directory Structure

After initialization, your project will contain:

```
your-project/
  .vibe-racer.yml              # config file
  plans/                        # task plan folders
    0001_my-feature/
      state.yml                 # pipeline state
      00_objective.md           # your objective
      01_product_questions.md   # race-engineer-generated (after first drive)
      01_product.md             # race-engineer-generated product spec
      ...
      05_qa.md                  # QA report
      06_decision.md            # post-deploy checklist
  .vibe-racer/                  # internal state (gitignored)
    audit.log                   # guard denial audit log
```

## Git Integration

vibe-racer creates a branch for each task:

```
vibe-racer/0001_my-feature
vibe-racer/0002_fix-login-bug
```

Commits are made automatically after each lap. vibe-racer never pushes to remote -- you control when to push and create PRs.
