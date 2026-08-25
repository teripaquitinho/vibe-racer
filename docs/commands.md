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
| `--retry` | Retry tasks in error state, resuming from the stage that failed |

**What it does:**
1. Checks prerequisites (git, API key)
2. Scans for tasks with ticked checkboxes and advances them
3. Finds race-engineer-actionable tasks (or uses `--task`)
4. Creates/checks out the task branch
5. Runs the appropriate Claude Code session with the lap's persona and skills
6. Commits artifacts

If multiple tasks are actionable, prompts you to choose.

**`--retry`:** when a session fails, the task moves to `error` and the stage it failed at is
recorded in `error_stage`. `--retry` reads that field, restores the task to that stage, and
dispatches its handler once. If `error_stage` holds something the current version doesn't
recognize (an older release wrote handler names there), `drive` says so and asks you to set
`stage:` in `state.yml` by hand rather than guessing.

**The final pit stop is enforced:** at `need_decision`, `drive` refuses to finish a task while
any `- [ ]` remains in `06_decision.md`. It prints each unworked line with its line number and
unticks the completion checkbox.

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

---

## `vibe-racer fasten`

Run dead code analysis and create a cleanup plan.

```bash
vibe-racer fasten
vibe-racer fasten --force
```

**Options:**

| Flag | Description |
|---|---|
| `--force` | Create a new fasten plan even if an active one exists |

**What it does:**
1. Checks for active fasten plans (warns if one exists; use `--force` to override)
2. Runs a dead code analysis via Claude (read-only — scans codebase without writing)
3. Creates a plan folder (`NNNN_fasten-YYYY-MM-DD`) with findings in `00_objective.md`
4. Writes its findings straight into `03_plan_questions.md`, which marks the plan trivial — skipping the product and design laps
5. Prints a summary; review the findings, tick the checkbox, then `vibe-racer drive`

If no dead code is found, no plan folder is created and a clean message is printed.
