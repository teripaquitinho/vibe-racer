# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in vibe-racer, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email the maintainer directly. You will receive an acknowledgment within 48 hours and a detailed response within 7 days.

We follow a 90-day disclosure window: after reporting, we aim to release a fix within 90 days before any public disclosure.

## Security Posture

vibe-racer runs Claude Code sessions with `bypassPermissions` — the AI agent executes tools without human approval prompts. To constrain agent behavior, a multi-layered security system is enforced on every session.

### What's protected

- **Path containment**: File operations are restricted to the project directory and `/tmp`. Symlink resolution prevents escape attacks.
- **Sensitive path blocklist**: `~/.ssh`, `~/.aws`, `~/.gnupg`, `/etc/shadow`, and other well-known sensitive locations are always denied.
- **Dotenv protection**: `.env*` files anywhere in the project tree are denied for Read, Write, and Edit.
- **Bash filtering**: 19 dangerous commands are blocked (`curl`, `wget`, `ssh`, `sudo`, etc.). Interpreter-aware detection catches inline network calls via `node -e`, `python3 -c`, `ruby -e`, `perl -e`, `php -r`. Obfuscation heuristics catch base64 encoding and character code construction patterns.
- **Review-stage restrictions**: During review stages, Write and Edit are limited to the task's plan folder. Bash is not available.
- **Pre-commit secret scanning**: Every commit scans staged files for API keys, private key blocks, credentials files, and other secret patterns. Flagged files are unstaged and the commit is blocked.
- **Audit log**: All guard denials are logged to `.vibe-racer/audit.log` as append-only JSONL.

### Known limitations

| Limitation | Why it's accepted |
|---|---|
| Shell encoding tricks can bypass the bash blocklist | Friction-based guardrail, not containment. Use Docker for full mitigation. |
| File-indirection and string-concatenation bypass the interpreter filter | Diminishing returns on heuristic detection. Docker `--network none` is the real fix. |
| `/tmp` is an allowed write target | Required by normal dev toolchains. Network blocklist limits exfiltration via `/tmp`. |
| Novel secret formats may pass the pre-commit scan | Common patterns covered. Can be extended as new formats emerge. |

### Recommendation for sensitive workloads

For codebases containing production secrets or sensitive data, run vibe-racer inside Docker with network isolation:

```bash
docker run --network none -v $(pwd):/workspace -w /workspace vibe-racer drive
```

This eliminates network exfiltration risk entirely.

## Scope

**In scope**: Guard bypasses, path escapes, secret leaks, unintended tool access, audit log failures.

**Out of scope**: Social engineering, supply-chain attacks on npm dependencies, attacks requiring physical access.
