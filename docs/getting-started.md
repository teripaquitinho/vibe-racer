# Getting Started

## Prerequisites

- **Node.js 20+** -- check with `node --version`
- **Anthropic API key** -- get one at [platform.claude.com](https://platform.claude.com/)

Set your API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or use `claude login` if you have Claude Code installed.

## Install

```bash
npm install -g vibe-racer
```

Verify the installation:

```bash
vibe-racer --version
# 0.2.0
```

## Your First Race

### 1. Initialize your project

Navigate to any project directory and run:

```bash
cd your-project
vibe-racer init
```

This creates:
- `.vibe-racer.yml` -- configuration file
- `plans/` -- directory for task plan documents

### 2. Create a task

```bash
vibe-racer new "Add user authentication"
```

This creates `plans/0001_add-user-authentication/` with:
- `state.yml` -- pipeline state tracker
- `00_objective.md` -- your objective template

### 3. Write your objective

Open `plans/0001_add-user-authentication/00_objective.md` and describe what you want to build. Be as detailed or as brief as you like -- the race engineer will ask clarifying questions.

Then tick the checkbox at the bottom:

```markdown
- [x] Ready to advance to Objective Review
```

### 4. Drive the first lap

```bash
vibe-racer drive
```

The race engineer picks up your task, reads the objective, and generates product-scoping questions in `01_product_questions.md`. Each question includes the race engineer's recommended answer pre-filled.

### 5. Review at the pit stop and iterate

Open the questions file. Read each answer. Edit only what you disagree with. Then tick the checkbox at the bottom and drive again:

```bash
vibe-racer drive
```

Repeat this cycle through all 7 laps:

```
Lap 1: Objective -> Lap 2: Product -> Lap 3: Design -> Lap 4: Plan ->
Lap 5: Execute -> Lap 6: QA -> Lap 7: Decision
```

The last two laps run after the code is written: the race engineer QAs its own work in
`05_qa.md`, and then writes a post-deploy checklist in `06_decision.md` that you must work
through before the task can reach `done`.

### 6. Check the pit wall

At any point, see where your tasks stand:

```bash
vibe-racer pitwall
```

## What Happens at Each Lap

| Lap | You do | Race engineer does |
|---|---|---|
| Objective | Write what you want to build | Reviews, asks product questions |
| Product | Review/edit pre-filled answers | Writes product spec, asks design questions |
| Design | Review/edit pre-filled answers | Writes design spec, asks plan questions |
| Plan | Review/edit pre-filled answers | Writes implementation plan + execution playbook |
| Execute | Review the plan, tick the checkbox | Implements code milestone by milestone |
| QA | Act on the findings, tick the checkbox | Reviews its own work, writes the QA report |
| Decision | Work the post-deploy checklist | Cleans up, writes the decision checklist |

## Tips

- **You don't need to fill everything in** -- the race engineer pre-fills recommended answers. Only edit disagreements.
- **If the race engineer needs more info**, it will radio back with follow-up questions and uncheck the checkbox. Answer them and re-tick.
- **Small tasks?** The race engineer can flag them as trivial during objective review, skipping product and design laps.
- **Need to discuss?** Use `vibe-racer radio` to open an interactive session with the race engineer at a pit stop.
- **The decision checklist is enforced** -- at the final pit stop, every `- [ ]` in `06_decision.md` must be ticked. `drive` prints the unworked lines and refuses to finish the task until they are.
