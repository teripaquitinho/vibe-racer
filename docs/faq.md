# FAQ

## General

### How much does it cost per task?

Each Claude Code session costs roughly $0.50-2.00 depending on complexity. A full 5-lap pipeline for a medium-sized feature typically costs $3-8 total across all laps. Execution is the most expensive lap since it involves actual code generation and iteration.

### Can I use vibe-racer with other AI providers?

No. vibe-racer is built on the Claude Code SDK and requires an Anthropic API key. It uses Claude Code's built-in file editing, git integration, and codebase understanding capabilities.

### Does vibe-racer modify my project's dependencies?

No. vibe-racer is a standalone CLI installed globally. It only adds `.vibe-racer.yml`, a `plans/` directory, and a `.vibe-racer/` directory (gitignored) to your project.

---

## Setup

### How do I set up my API key?

Set the `ANTHROPIC_API_KEY` environment variable:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or add it to your shell profile (`.bashrc`, `.zshrc`). Alternatively, run `claude login` if you have the Claude Code CLI installed.

### What Node.js version do I need?

Node.js 20 or later. Check with `node --version`.

---

## Pipeline

### Can I skip laps?

Yes, for small tasks. During objective review, the race engineer can flag a task as trivial, which skips the product and design laps. You cannot manually skip laps.

### What if the race engineer's answers are wrong?

Edit them! The pre-filled answers are recommendations. Change any answer you disagree with before ticking the checkbox. The race engineer will use your edited answers for the next lap.

### What if the race engineer keeps asking follow-up questions?

The race engineer is limited to 3 follow-up rounds per lap. After 3 rounds, it proceeds with available information. If it consistently needs more info, your objective may need more detail.

### Can I go back to a previous lap?

Not directly through the CLI. You can manually edit `state.yml` to set the stage back, but this is not officially supported and may leave artifacts from later laps.

---

## Errors

### What do I do when a task enters error state?

Run `vibe-racer drive --retry` to reprocess. The race engineer will attempt the same lap again. Check `.vibe-racer/audit.log` for guard denials that may have caused the error.

### Tests are failing during execution -- what happens?

The race engineer will attempt to fix failing tests as part of its execution loop. If it cannot fix them after its turn limit, the task will enter error state. Use `--retry` to try again, or fix the tests manually and tick the checkbox.

---

## Git

### Does vibe-racer push to remote?

No. All operations are local. Branches are created and commits are made, but nothing is pushed. You control when to push and create pull requests.

### Can I use vibe-racer on multiple tasks simultaneously?

Each task gets its own branch, so you can have multiple tasks in progress. However, `vibe-racer drive` processes one task at a time. Run it multiple times or use `--task N` to target specific tasks.

### Where are plan files stored?

In `plans/NNNN_slug/` directories within your project. These are regular files committed to git -- they serve as project history and documentation.

---

## Security

### Is it safe to run with autonomous permissions?

vibe-racer enforces a multi-layered security guard on every session. See the [Security](/security) page for full details. For sensitive codebases, run inside Docker with `--network none`.

### How do I check what the race engineer tried to do?

Check `.vibe-racer/audit.log` -- all guard denials are logged as JSONL with timestamps, tool names, inputs, and denial reasons.
