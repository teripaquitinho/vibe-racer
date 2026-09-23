# Security

vibe-racer runs Claude Code sessions with autonomous permissions (`bypassPermissions`). To
constrain agent behavior, a multi-layered security system is enforced on every **SDK session** —
every session that `drive` (and `fasten`) starts through `runAndStream`. One command is not such
a session: `radio` spawns your own interactive `claude` CLI, and none of what follows applies to
it. See [What is a guarded session](#what-is-a-guarded-session).

## Two-Layer Permission Model

### Layer 1: Allowed Tools (Coarse Gate)

Each pipeline stage defines which tools the agent can use:

- **Review stages** (objective, product, design, plan): Read, Write (plan folder only), Glob, Grep. No Edit, no Bash.
- **QA stage**: Read, Glob, Grep, Write (plan folder only), Bash. QA needs Bash to run the build, lint, and test commands it reports on, but is write-jailed to the plan folder so it cannot fix what it finds.
- **Decision session**: Read, Glob, Grep, Write. No Edit, no Bash.
- **Execution and cleanup sessions**: Full tool access including Edit and Bash.
- **`fasten` analysis**: Read, Glob, Grep. It runs under the objective-review stage's rules, so it can write nothing.
- **Human stages** (`need_objective`, `need_product`, `need_design`, `need_execution`, `need_operator`, `fine_tuning`, `need_decision`): no session runs. Nothing is granted because nothing is started.

When a lap resolves skills, `Skill` is appended to the stage's tool list for that session.

### Layer 2: Tool Guard (Fine Gate)

A `canUseTool` callback intercepts every tool invocation and enforces 6 rules:

#### 0. `state.yml` Is Pipeline-Owned

`Write` and `Edit` are denied on any file named `state.yml` under `plans_dir`, at **every**
stage — including execution, which otherwise has full tool access. Only vibe-racer moves a
task between stages. That includes the `need_operator` detour: the execute handler writes the
pause and the resume into `state.yml`; the agent only ever signals through `04_execute.md`.

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

The cleanup session is **not** plan-jailed: it legitimately updates project documentation across the repo.

The decision session shares its stage (`cleanup_ready`) but writes exactly one file, so it opts into the jail explicitly via `jailToPlanDir`, a per-session flag that applies Rule 4a regardless of stage. Stage alone cannot separate two sessions that run back to back under the same stage. It is additionally constrained by its `allowedTools` (no Edit, no Bash).

The four review stages (objective, product, design, plan) may not shell out at all: Bash is denied there even if it were in the tool list.

#### 5. Bash Command Filter

**Blocklist (18 commands):** `curl`, `wget`, `nc`, `netcat`, `ncat`, `socat`, `telnet`, `ftp`, `sftp`, `ssh`, `scp`, `rsync`, `sudo`, `su`, `chmod`, `chown`, `dd`, `mkfs`

Both direct invocation and `/usr/bin/` form are detected.

**Interpreter-aware network detection:** Catches inline network calls via:
- `node -e` / `--eval` / `-p` / `--print` with `http`, `https`, `net`, `dgram`, `dns`, `tls`, `fetch`, `child_process`, `execSync`, `spawnSync`
- `python -c` / `python3 -c` with `urllib`, `requests`, `http.client`, `socket`, `subprocess`
- `ruby -e` with `net/http`, `open-uri`
- `perl -e` / `-E` with `LWP`, `HTTP::Tiny`, `IO::Socket`
- `php -r` with `file_get_contents` of an `http(s)` URL, `curl_init`, `fsockopen`

**Obfuscation heuristics:** Catches `eval(Buffer.from(...))` base64 encoding and `String.fromCharCode(...)` character code construction.

**Path references in commands:** an absolute or `~/` path in a command that points at a sensitive path (Rule 1) or outside the project and `/tmp` (Rule 2) is denied, so `cat ~/.ssh/id_rsa` is caught at the Bash layer too.

**Special cases:** `rm -rf /` and `rm -rf ~` patterns are explicitly blocked.

**Not on the list:** `git push`, `gh pr create`, `gh pr merge`, `gh release`, `gh workflow run`.
The rule that vibe-racer never pushes is a prompt rule — see
[Known Limitations](#known-limitations).

## What is a guarded session

Both layers above exist inside `runAndStream`, which is how `drive` runs every lap and how
`fasten` runs its analysis. They are not a property of the `claude` binary.

`radio` is different. It spawns **your own interactive `claude` CLI** with a system prompt for
the task's stage (`spawn("claude", ["--system-prompt", …])`). Whatever permission mode and
settings your CLI has are what apply: `canUseTool` does not run, so Rule 0, the path jail, the
sensitive-path blocklist and the Bash filter are all absent. The prompt asks the session not to
push, open PRs, merge or deploy, and at `need_operator` not to tick the resume marker — but
nothing enforces any of that except the prompt and your CLI's own permission prompts. This has
been true of `radio` at every stage since it shipped; it is stated here because the declaration
previously implied otherwise.

## Operator gates and `need_operator`

Execution can pause for the operator — on a planned `Owner = operator` row, on an agent that
declares `needs_operator`, on a stall, or on the per-`drive` session cap. Four things about that
detour matter here.

- **No session runs while paused.** `need_operator` is a human stage. `drive` starts nothing
  until the resume marker in `04_execute.md` is ticked and every item above it is ticked too.
  The stage change itself is written by the handler (`pauseForOperator`, `resumeFromOperator`),
  never by the agent — Rule 0 is unchanged.
- **Gate verification deliberately uses the network.** The milestone after a gate begins by
  running the gate's read-only `**Verification:**` line — `git fetch`, `git merge-base
  --is-ancestor`, `gh pr view` — from inside an execute session, on your machine. None of those
  commands is on the blocklist. This sits next to the Docker `--network none` recommendation on
  purpose: under `--network none` the check cannot run, and the agent falls back to local refs
  and then to your tick, saying so in the session output. A sandboxed operator can still pass a
  gate; the sandbox costs the remote check, not the pause.
- **Agent prose is committed.** Every pause appends a block to `04_execute.md` that quotes the
  agent's final message. The message is quoted **inertly** — behind `> ` and inside a `~~~`
  fence longer than any run it contains — so a checkbox, a heading or a ticked resume marker in
  the agent's own words is never counted: a session cannot resume its own task through its
  final message. The block is committed by the pause's own commit (`vibe-racer: paused for
  operator at …`), which passes through the pre-commit secret scan below like every other
  commit — and if the scan blocks it, the task stays paused with the block uncommitted (see
  "Pre-Commit Secret Scanning").
- **The execute session has `Edit` on the playbook.** An execute session can write
  `04_execute.md` freely, including a pause block of its own. The handler therefore
  **normalises, never trusts** an agent-authored block: it unticks every checkbox in it, the
  resume marker included, rewrites the heading and the closing line itself, re-renders the whole
  block if it lacks the minimum content, and reads the agent's `**Why paused:**` line only as a
  quoted one-liner for `state.yml`. Only the last block in the file is read on resume.

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

Every `commitAll()` call — each lap's commit, each milestone's commit, the pause block's commit
and the partial-work commit on error — scans staged files before committing:

**Filename patterns:** `.env*`, `credentials.json`, `.pem`, `.key`

**Content patterns:**
- AWS access keys (`AKIA...`)
- PEM private key blocks
- GitHub personal access tokens (`ghp_...`)
- API key patterns (`sk-...`)

Files up to 100 KB are content-scanned. On match, flagged files are unstaged and the commit is blocked.

What happens next depends on which commit it was. For a lap, milestone or completion commit the
error propagates and `drive` stops with it — it is never buried and never turns into
`stage: error`. For the **pause commit** the handler catches it at that one call site, because by
then `state.yml` already says `need_operator`: the task stays paused, `04_execute.md` holds the
pause block uncommitted, and the terminal names the file and says what to do. Nothing is redacted
for you and nothing is committed; you redact the token, commit by hand, then tick the resume
marker as usual. The scan itself is unchanged by that catch.

## Audit Log

All guard denials are written to `.vibe-racer/audit.log` as append-only JSONL. Each entry includes:

```json
{"ts":"...","stage":"...","tool":"...","input":"...","reason":"..."}
```

The audit log has a 1 MB size cap. Audit write failures never break the guard (fail-open for logging, fail-closed for enforcement).

## Known Limitations

| Limitation | Mitigation |
|---|---|
| **"vibe-racer never pushes" is a prompt rule only.** The guard does not block `git push`, `gh pr create`, `gh pr merge`, `gh release` or `gh workflow run` in an execute session | Follow-up task #6, *Guard enforces the no-push rule*, adds a `ready_to_execute` deny list and must keep the read-only `git fetch`, `gh pr view` and `gh pr list` allowed so gate verification keeps working. Until it lands: the branch is never pushed by the pipeline, so nothing leaves your machine unless a session disobeys the prompt |
| **`radio` is not a guarded session.** It runs your own `claude` CLI: no `canUseTool`, no Rule 0, no path jail, no Bash filter | Your CLI's own permission mode applies. Treat a radio session as you would any interactive `claude` session in the repo |
| Gate verification runs `git fetch` / `gh pr view` from an execute session | Read-only by design; under `--network none` the agent falls back to local refs and then to your tick, and says which one it used |
| An execute session can edit `04_execute.md` and `03_plan.md`, including the pause block and the gate checklist | The handler unticks every box in the pause block, rewrites its heading and closing line, and re-renders it if it is incomplete; only the last block is read; a `- [ ]` behind `> ` is never counted. The table and checklist are otherwise yours to review in `git diff` |
| Shell encoding tricks (`cu""rl`, `$variable`) bypass bash blocklist | Use Docker `--network none` for full containment |
| File-indirection and string-concatenation bypass interpreter filter | Docker `--network none` is the real fix |
| `/tmp` is an allowed write target | Network blocklist limits what can be done with data staged in `/tmp` |
| Novel secret formats may pass the pre-commit scan | Common patterns covered; can be extended |
| Prompt injection via project files | Guard constrains blast radius but can't prevent all injected instructions |
| Bash can still write `state.yml` (Rule 0 covers Write/Edit only) | No prompt instructs it; the bash blocklist and audit log cover the rest |
| Project and user settings (hooks, MCP servers, permissions) are loaded into every session | Review `.claude/settings.json` in untrusted repos; the tool guard still applies |
| The cleanup session has repo-wide write access | Unavoidable — it is the lap that updates docs. Its output is committed on your branch and visible in `git diff` |

## Docker Recommendation

For sensitive workloads, run vibe-racer inside Docker with network isolation:

```bash
docker run --network none -v $(pwd):/workspace -w /workspace vibe-racer drive
```

This eliminates network exfiltration risk entirely. It also disables the remote half of gate
verification: the milestone after an operator gate cannot run `git fetch` or `gh pr view`, so
it takes local refs, then your tick, as the answer.

## Security Posture Summary

vibe-racer's guard is a **guardrail, not a sandbox**, and it guards the sessions `drive` and
`fasten` start — not `radio`. It provides:

- **Strong protection** against accidental scope creep, sensitive file access, and naive exfiltration
- **Moderate protection** against direct network exfiltration via bash and interpreters
- **No protection** against sophisticated adversarial attacks
- **No enforcement** of the no-push rule — that is the prompt's, until follow-up #6 lands

All AI-generated code should be reviewed by a human before merging.
