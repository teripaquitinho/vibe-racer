# Security

vibe-racer runs Claude Code sessions with autonomous permissions (`bypassPermissions`). To constrain agent behavior, a multi-layered security system is enforced on every session.

## Two-Layer Permission Model

### Layer 1: Allowed Tools (Coarse Gate)

Each pipeline stage defines which tools the agent can use:

- **Review stages** (objective, product, design, plan): Read, Write (plan folder only), Glob, Grep. No Edit, no Bash.
- **QA stage**: Read, Glob, Grep, Write (plan folder only), Bash. QA needs Bash to run the build, lint, and test commands it reports on, but is write-jailed to the plan folder so it cannot fix what it finds.
- **Decision session**: Read, Glob, Grep, Write. No Edit, no Bash.
- **Execution stages**: Full tool access including Edit and Bash.

### Layer 2: Tool Guard (Fine Gate)

A `canUseTool` callback intercepts every tool invocation and enforces 6 rules:

#### 0. `state.yml` Is Pipeline-Owned

`Write` and `Edit` are denied on any file named `state.yml` under `plans_dir`, at **every**
stage — including execution, which otherwise has full tool access. Only vibe-racer moves a
task between stages.

This rule exists because of a real incident: a review session wrote `state.yml` itself,
guessed the stage-enum values, and produced `next: ai_plan` (no such stage). The schema
rejected it on the next read, and the error-recovery path — which also starts by reading
`state.yml` — died on the same corrupt file. The task was unrecoverable without hand-editing.

**Limitation:** the rule is keyed on `Write`/`Edit`. A Bash redirect (`echo > state.yml`,
`sed -i`) is not intercepted. This is a known gap, accepted because the incident was a `Write`
call and no prompt instructs shell-writing `state.yml`.

`setError` is also hardened independently: if `state.yml` cannot be parsed, it salvages what
it can from the raw YAML, and falls back to hand-writing a minimal valid error record. The
recovery path can no longer be taken out by the corruption it is recording.

#### 1. Sensitive Path Blocklist

These paths are always denied, regardless of stage:

- `~/.ssh`
- `~/.aws`
- `~/.gnupg`
- `~/.config/gcloud`
- `~/.netrc`
- `~/.env`
- `/etc/shadow`
- `/etc/passwd`

#### 2. Path Containment

All file operations (Read, Write, Edit, Glob, Grep) are restricted to:
- The project directory (`cwd`)
- `/tmp` (needed for build toolchains)

Symlink resolution via `fs.realpathSync()` prevents escape attacks. Path traversal (`../`) is neutralized by `path.resolve()`. Sibling directory prefix collision is prevented by appending `path.sep` before `startsWith()` checks.

#### 3. Dotenv Protection

Any file matching `.env*` (`.env`, `.env.local`, `.env.production`, etc.) is denied for Read, Write, and Edit operations, anywhere in the project tree.

#### 4. Review-Stage Write Restriction

During review stages — objective, product, design, plan, and QA — Write and Edit are restricted to the task's plan folder (`plans/<task>/`). This prevents the agent from modifying source code during review, and is what keeps the QA lap judging rather than fixing.

The cleanup and decision sessions are **not** plan-jailed: cleanup legitimately updates project documentation. The decision session is constrained instead by its `allowedTools` (no Edit, no Bash).

#### 5. Bash Command Filter

**Blocklist (19 commands):** `curl`, `wget`, `nc`, `netcat`, `ncat`, `socat`, `telnet`, `ftp`, `sftp`, `ssh`, `scp`, `rsync`, `sudo`, `su`, `chmod`, `chown`, `dd`, `mkfs`

Both direct invocation and `/usr/bin/` form are detected.

**Interpreter-aware network detection:** Catches inline network calls via:
- `node -e` / `node --eval` with `http`, `https`, `fetch`, `net`, `child_process`
- `python3 -c` with `urllib`, `requests`, `http.client`, `socket`, `subprocess`
- `ruby -e` with `net/http`, `open-uri`, `socket`
- `perl -e` with `LWP`, `HTTP::Tiny`, `IO::Socket`
- `php -r` with `file_get_contents`, `curl_exec`, `fsockopen`

**Obfuscation heuristics:** Catches `eval(Buffer.from(...))` base64 encoding and `String.fromCharCode(...)` character code construction.

**Special cases:** `rm -rf /` and `rm -rf ~` patterns are explicitly blocked.

## Setting Sources

Sessions are started with `settingSources: ["project", "user"]`, which is what makes
project-level and user-level Claude Code skills available to each lap.

This widens the trust boundary. Both scopes are loaded into a session running with
`bypassPermissions`, which means the following are in effect during a race:

- **Hooks** from `.claude/settings.json` (project) and `~/.claude/settings.json` (user) —
  arbitrary commands that run on tool events
- **Permission rules** from either scope
- **MCP servers** configured in either scope
- **`additionalDirectories`**, which can extend the reachable filesystem beyond `cwd`

The `canUseTool` guard still runs on every tool invocation, so path containment, the
sensitive-path blocklist, dotenv protection, and the bash filter apply regardless of what
settings are loaded. But a hostile or careless entry in either settings file is now part of
your race's trust boundary. Two consequences worth acting on:

- Treat `.claude/settings.json` in a cloned repo as executable content — review it before
  racing a project you do not control.
- Your own `~/.claude/settings.json` applies to every project you race, not just the ones you
  wrote it for.

## Pre-Commit Secret Scanning

Every `commitAll()` call scans staged files before committing:

**Filename patterns:** `.env*`, `credentials.json`, `.pem`, `.key`

**Content patterns:**
- AWS access keys (`AKIA...`)
- PEM private key blocks
- GitHub personal access tokens (`ghp_...`)
- API key patterns (`sk-...`)

Files up to 100 KB are content-scanned. On match, flagged files are unstaged and the commit is blocked.

## Audit Log

All guard denials are written to `.vibe-racer/audit.log` as append-only JSONL. Each entry includes:

```json
{"timestamp":"...","stage":"...","tool":"...","input":"...","reason":"..."}
```

The audit log has a 1 MB size cap. Audit write failures never break the guard (fail-open for logging, fail-closed for enforcement).

## Known Limitations

| Limitation | Mitigation |
|---|---|
| Shell encoding tricks (`cu""rl`, `$variable`) bypass bash blocklist | Use Docker `--network none` for full containment |
| File-indirection and string-concatenation bypass interpreter filter | Docker `--network none` is the real fix |
| `/tmp` is an allowed write target | Network blocklist limits what can be done with data staged in `/tmp` |
| Novel secret formats may pass the pre-commit scan | Common patterns covered; can be extended |
| Prompt injection via project files | Guard constrains blast radius but can't prevent all injected instructions |
| Bash can still write `state.yml` (Rule 0 covers Write/Edit only) | No prompt instructs it; the bash blocklist and audit log cover the rest |
| Project and user settings (hooks, MCP servers, permissions) are loaded into every session | Review `.claude/settings.json` in untrusted repos; the tool guard still applies |

## Docker Recommendation

For sensitive workloads, run vibe-racer inside Docker with network isolation:

```bash
docker run --network none -v $(pwd):/workspace -w /workspace vibe-racer drive
```

This eliminates network exfiltration risk entirely.

## Security Posture Summary

vibe-racer's guard is a **guardrail, not a sandbox**. It provides:

- **Strong protection** against accidental scope creep, sensitive file access, and naive exfiltration
- **Moderate protection** against direct network exfiltration via bash and interpreters
- **No protection** against sophisticated adversarial attacks

All AI-generated code should be reviewed by a human before merging.
