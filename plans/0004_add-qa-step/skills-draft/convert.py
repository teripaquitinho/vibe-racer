#!/usr/bin/env python3
"""
Convert Claude Code custom slash commands (.claude/commands/*.md) into
skills (~/.claude/skills/<name>/SKILL.md).

Why: vibe-racer's Workstream B advertises skills via the `Skill` tool. Slash
commands are expanded client-side when a human types `/name` — there is no
human in a headless SDK session, so commands cannot be invoked that way. They
DO appear in supportedCommands(), which makes them worse than missing: they
resolve without warning and are then uninvocable.

Transform, per file:
  - frontmatter `description:` is preserved verbatim
  - frontmatter gains `name:` (from the filename)
  - frontmatter `argument-hint:` is dropped (no invoker passes args)
  - body `$ARGUMENTS` references are rewritten to point at the task context
  - body is otherwise copied byte-for-byte

Usage:
  python3 convert.py <src-dir-containing-commands> <out-dir>
  e.g. python3 convert.py ~/.claude-cmds-tmp/.claude/commands ./skills-draft
"""
import os, re, sys

ARG_NOTE = ("Operate on the current task context: the files, diff, or component under "
            "discussion. If the scope is ambiguous, run `git diff` / `git diff --staged` "
            "to find pending changes, and state your assumed scope before proceeding.")

def split_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not m:
        return None, text
    return m.group(1), m.group(2)

def convert(path, name):
    raw = open(path, encoding="utf-8").read()
    fm, body = split_frontmatter(raw)
    desc = ""
    if fm:
        d = re.search(r"^description:\s*(.+)$", fm, re.M)
        if d:
            desc = d.group(1).strip()

    # Rewrite $ARGUMENTS: a line that is mostly the placeholder becomes the note;
    # inline uses become "the code under review" style phrasing.
    lines = []
    for ln in body.split("\n"):
        if "$ARGUMENTS" in ln:
            stripped = ln.replace("$ARGUMENTS", "").strip()
            if len(stripped) < 60:
                lines.append(stripped.rstrip(":").strip())
                lines.append("")
                lines.append(ARG_NOTE)
                continue
            ln = ln.replace("$ARGUMENTS", "the current task context")
        lines.append(ln)
    body = "\n".join(lines).strip()

    esc = desc.replace('"', '\\"')
    return f'---\nname: {name}\ndescription: "{esc}"\n---\n\n{body}\n'

def main():
    if len(sys.argv) != 3:
        print(__doc__); sys.exit(2)
    src, out = os.path.expanduser(sys.argv[1]), os.path.expanduser(sys.argv[2])
    files = sorted(f for f in os.listdir(src) if f.endswith(".md") and f.lower() != "readme.md")
    if not files:
        print(f"No command .md files in {src}"); sys.exit(1)
    for f in files:
        name = f[:-3]
        d = os.path.join(out, name)
        os.makedirs(d, exist_ok=True)
        content = convert(os.path.join(src, f), name)
        open(os.path.join(d, "SKILL.md"), "w", encoding="utf-8").write(content)
        print(f"  {f:28s} -> {name}/SKILL.md  ({len(content)} bytes)")
    print(f"\n{len(files)} skills written to {out}")
    print("Install with:  cp -r <out>/*/ ~/.claude/skills/")

if __name__ == "__main__":
    main()
