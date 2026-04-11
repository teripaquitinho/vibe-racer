# Security

vibe-racer runs Claude Code sessions with autonomous permissions (`bypassPermissions`). To constrain agent behavior, a multi-layered security system is enforced on every session.

## Two-Layer Permission Model

### Layer 1: Allowed Tools (Coarse Gate)

Each pipeline stage defines which tools the agent can use:

- **Review stages** (objective, product, design, plan): Read, Write (plan folder only), Glob, Grep. No Edit, no Bash.
- **Execution stages**: Full tool access including Edit and Bash.

### Layer 2: Tool Guard (Fine Gate)

A `canUseTool` callback intercepts every tool invocation and enforces 5 rules:

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

During review stages, Write and Edit are restricted to the task's plan folder (`plans/<task>/`). This prevents the agent from modifying source code during review.

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
