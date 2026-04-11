# Commands

## `vibe-racer init`

Initialize vibe-racer in the current directory.

```bash
vibe-racer init
```

**What it does:**
- Checks for `.git/` -- runs `git init` if missing
- Prompts for optional GitHub repo URL (enables share links)
- Creates `.vibe-racer.yml` configuration file
- Creates `plans/` directory
- Scaffolds `README.md` and `CLAUDE.md` if they don't exist

---

## `vibe-racer new <title>`

Create a new task.

```bash
vibe-racer new "Add user authentication"
vibe-racer new "Fix login bug" -d "Users are getting 500 errors on the login page"
```

**Options:**

| Flag | Description |
|---|---|
| `-d, --desc <text>` | Pre-populate the objective file with this description |

**What it does:**
- Assigns the next sequential task number (scans existing plan folders)
- Creates `plans/NNNN_slug/` directory
- Writes `00_objective.md` template (with `-d` content if provided)
- Writes `state.yml` with `stage: need_objective`

---

## `vibe-racer pitwall`

View the pit wall — live status for every car in the race.

```bash
vibe-racer pitwall
vibe-racer pitwall --all
```

**Options:**

| Flag | Description |
|---|---|
| `--all` | Include completed tasks in the output |

**Output sections:**
- **Waiting on race engineer** -- tasks at agent-actionable laps
- **Waiting at pit stop** -- tasks waiting for human review
- **Errors** -- tasks that failed during race engineer processing
- **Done** -- completed tasks (only with `--all`)
- **Orphan branches** -- git branches with no matching task

---

## `vibe-racer drive`

Drive the next lap — hand the car to the race engineer for the next stage.

```bash
vibe-racer drive
vibe-racer drive --task 3
vibe-racer drive --retry
```

**Options:**

| Flag | Description |
|---|---|
| `-t, --task <number>` | Drive a specific task by number |
| `--retry` | Retry tasks in error state |

**What it does:**
1. Checks prerequisites (git, API key)
2. Scans for tasks with ticked checkboxes and advances them
3. Finds race-engineer-actionable tasks (or uses `--task`)
4. Creates/checks out the task branch
5. Runs the appropriate Claude Code session with the lap's persona
6. Commits artifacts

If multiple tasks are actionable, prompts you to choose.

---

## `vibe-racer radio`

Pick up the team radio — open an interactive session with the race engineer at a pit stop.

```bash
vibe-racer radio
vibe-racer radio --task 2
```

**Options:**

| Flag | Description |
|---|---|
| `-t, --task <number>` | Open radio for a specific task |

**What it does:**
- Opens a Claude CLI session with the task's context loaded
- Useful for discussing generated specs, asking questions about the plan, or getting clarification before ticking the checkbox
- Only available for tasks at pit stop stages
