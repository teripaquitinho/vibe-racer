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
```

### Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `repo` | string (optional) | -- | GitHub repository URL (HTTPS or SSH). Enables share links in generated documents. |
| `plans_dir` | string | `"plans"` | Directory where task plan folders are created. Relative to project root. |
| `context` | string[] | `["README.md", "CLAUDE.md"]` | Files loaded into Claude's context for every session. Use this to give the race engineer project-specific knowledge. |

### Context Files

The `context` array tells vibe-racer which files to include in every Claude Code session. These files help the race engineer understand your project's architecture, conventions, and constraints.

Good candidates for context files:
- `README.md` -- project overview
- `CLAUDE.md` -- AI-specific instructions and project structure
- `ARCHITECTURE.md` -- system architecture documentation
- `docs/api.md` -- API documentation
- Any file that helps the race engineer make better decisions

Files are read relative to the project root. Non-existent files are silently skipped.

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
