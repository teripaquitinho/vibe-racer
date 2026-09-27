# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in vibe-racer, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email the maintainer directly. You will receive an acknowledgment within 48 hours and a detailed response within 7 days.

We follow a 90-day disclosure window: after reporting, we aim to release a fix within 90 days before any public disclosure.

## Security Posture

vibe-racer runs Claude Code sessions with `bypassPermissions` — the AI agent executes tools without human approval prompts. To constrain agent behavior, a multi-layered security system is enforced on every session that `drive` (and `fasten`) starts through the SDK. `radio` is not such a session — see below. The full declaration is [docs/security.md](docs/security.md); this section summarises it.

### What's protected

- **`state.yml` is pipeline-owned** (Rule 0): `Write` and `Edit` to any `state.yml` under the plans directory are denied at every stage, including execution. Only vibe-racer moves a task between stages — including into and out of the `need_operator` pause.
- **Path containment**: File operations are restricted to the project directory and `/tmp`. Symlink resolution prevents escape attacks.
- **Sensitive path blocklist**: `~/.ssh`, `~/.aws`, `~/.gnupg`, `/etc/shadow`, and other well-known sensitive locations are always denied.
- **Dotenv protection**: `.env*` files anywhere in the project tree are denied for Read, Write, and Edit.
- **Bash filtering**: 18 dangerous commands are blocked (`curl`, `wget`, `ssh`, `sudo`, etc.). Interpreter-aware detection catches inline network calls via `node -e`, `python3 -c`, `ruby -e`, `perl -e`, `php -r`. Obfuscation heuristics catch base64 encoding and character code construction patterns.
- **Review-stage restrictions**: During the objective, product, design and plan reviews, Write and Edit are limited to the task's plan folder and Bash is not available. The QA lap is also write-jailed to the plan folder but **has Bash**, so it can run the build, lint and tests it reports on without being able to fix what it finds. The decision session opts into the same jail via `jailToPlanDir`.
- **Human stages start no session**: `need_operator` and every other pit stop grant nothing because nothing runs.
- **Pre-commit secret scanning**: Every commit scans staged files for API keys, private key blocks, credentials files, and other secret patterns — including the operator pause block, which quotes the agent's final message into `04_execute.md`. Flagged files are unstaged and the commit is blocked. A blocked pause commit leaves the task at `need_operator` with the pause block written but uncommitted; you redact and commit by hand, then resume as usual.
- **Audit log**: All guard denials are logged to `.vibe-racer/audit.log` as append-only JSONL.

### Trust boundary

Sessions load `settingSources: ["project", "user"]` so Claude Code skills resolve. Hooks, permission rules, MCP servers and `additionalDirectories` from `.claude/settings.json` (project) and `~/.claude/settings.json` (user) are therefore in effect in a session running with `bypassPermissions`. The tool guard still runs on every call, but review `.claude/settings.json` before racing a repository you do not control.

### `radio` is not a guarded session

`vibe-racer radio` spawns your own interactive `claude` CLI with a stage-specific system prompt. `canUseTool`, Rule 0, the path jail and the Bash filter do not run there; your CLI's own permission mode is what applies. The prompt asks the session not to push, merge or deploy, and at `need_operator` not to tick the resume marker — nothing but the prompt enforces that.

### Known limitations

| Limitation | Why it's accepted |
|---|---|
| "vibe-racer never pushes" is a prompt rule only — the guard does not block `git push`, `gh pr create` or `gh pr merge` | Follow-up task #6, *Guard enforces the no-push rule*, adds the deny list while keeping read-only `git fetch` / `gh pr view` / `gh pr list` for gate verification. The pipeline itself never pushes. |
| `radio` runs outside the guard | It is your interactive CLI. Treat it as any `claude` session in the repo. |
| Gate verification runs `git fetch` / `gh pr view` from an execute session | Read-only by design. Under `--network none` the agent falls back to local refs, then to your tick, and says so. |
| An execute session can edit `04_execute.md`, including the pause block | The handler unticks every box in the block (the resume marker included) and re-renders it if it is incomplete; a checkbox inside the agent's quoted message is never counted. |
| Bash can still write `state.yml` (Rule 0 covers Write/Edit only) | No prompt instructs it; the Bash filter and audit log cover the rest. |
| Shell encoding tricks can bypass the bash blocklist | Friction-based guardrail, not containment. Use Docker for full mitigation. |
| File-indirection and string-concatenation bypass the interpreter filter | Diminishing returns on heuristic detection. Docker `--network none` is the real fix. |
| `/tmp` is an allowed write target | Required by normal dev toolchains. Network blocklist limits exfiltration via `/tmp`. |
| Novel secret formats may pass the pre-commit scan | Common patterns covered. Can be extended as new formats emerge. |
| Project and user settings are loaded into every session | Review `.claude/settings.json` in untrusted repos; the tool guard still applies. |

### Recommendation for sensitive workloads

For codebases containing production secrets or sensitive data, run vibe-racer inside Docker with network isolation:

```bash
docker run --network none -v $(pwd):/workspace -w /workspace vibe-racer drive
```

This eliminates network exfiltration risk entirely. It also disables the remote half of operator-gate verification, which then falls back to local refs and your tick.

## Scope

**In scope**: Guard bypasses, path escapes, secret leaks, unintended tool access, audit log failures.

**Out of scope**: Social engineering, supply-chain attacks on npm dependencies, attacks requiring physical access, and behaviour of your own `claude` CLI inside a `radio` session.
