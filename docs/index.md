---
layout: home

hero:
  name: vibe-racer
  text: Your AI race engineer
  tagline: Five laps from objective to shipped code — you call the pit stops.
  image:
    light: /logo.png
    dark: /logo-white.png
    alt: vibe-racer
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/teripaquitinho/vibe-racer

features:
  - title: Five Laps
    details: Every task races through objective, product, design, plan, and execution. No more jumping straight to code.
  - title: Pit Stops
    details: You approve every lap transition with a checkbox. The race engineer does the heavy lifting, you keep control.
  - title: Pre-filled Answers
    details: The race engineer recommends answers to every question. You only edit what you disagree with.
  - title: Role-Based Personas
    details: Product Designer, Software Architect, Software Engineer — the right expertise at each lap.
  - title: Security-First
    details: Path containment, bash blocklist, secret scanning, audit logging. A strong guardrail on every session.
  - title: Git-Native
    details: Local files, branches, and commits. No cloud dependencies, no database, no lock-in.
---

## What is vibe-racer?

Your project is the car. Every pipeline stage is a lap. Every human checkpoint is a pit stop. vibe-racer is the race engineer in your ear — it does the heavy work, calls the strategy, and hands you the final say on every decision.

LLMs generate code without product thinking. There's no requirements gathering, no design review, no structured planning. You get code, but not necessarily the right code.

vibe-racer fixes this by enforcing a structured development process where the race engineer handles the heavy lifting at each lap — generating specs, asking questions, writing plans — while you retain control at every pit stop.

## Quick Start

```bash
npm install -g vibe-racer
cd your-project
vibe-racer init
vibe-racer new "Add user authentication"
# Write your objective, tick the checkbox, then:
vibe-racer drive
```

Three commands to your first AI-assisted development cycle. [Full guide here](/getting-started).

---

## 10 Things You Need to Know

### 1. What it is

vibe-racer is an AI-powered development pipeline that races tasks through five laps: objective, product, design, plan, and execution. It uses Claude Code sessions with specialized personas at each lap to produce structured, high-quality software.

### 2. The problem

LLMs generate code without product thinking. There's no requirements gathering, no design review, no structured planning. You get code, but not necessarily the right code. The gap between "generate code" and "build software" is where bugs, scope creep, and rework live.

### 3. The solution

A 5-lap pipeline that forces proper software development process before a single line of code is written. The race engineer does the heavy lifting at each lap — generating specs, asking questions, writing plans — while you retain control at every pit stop.

### 4. Pit stops by design

You approve every lap transition via a simple checkbox. No black-box automation. The race engineer cannot advance to the next lap without your explicit sign-off. If it needs more information, it radios back with follow-up questions and waits.

### 5. Role-based AI personas

Each lap uses a specialized persona for higher quality output. A Senior Product Designer handles objective and product review. A Software Architect handles design. A Software Engineer handles planning and execution. The right expertise at the right lap.

### 6. Security-first

A multi-layered guard system constrains every AI session: path containment, bash command blocklist, interpreter-aware network detection, dotenv protection, pre-commit secret scanning, and an append-only audit log. Not a sandbox, but a strong guardrail with [documented limitations](/security).

### 7. Git-native

Everything is local files, git branches, and commits. No external dependencies, no cloud lock-in, no database. State lives in YAML files alongside the plan documents. Branches are created per task, commits happen after each lap. You control when to push and merge.

### 8. Pre-filled answers

The race engineer doesn't just ask questions — it pre-fills its recommended answers to every question. You review them and only edit what you disagree with. This dramatically reduces the time spent at pit stops while keeping you in full control.

### 9. Zero-config start

Three commands to your first AI-assisted development cycle:

```bash
vibe-racer init
vibe-racer new "my feature"
vibe-racer drive
```

No configuration files to write, no integrations to set up. Just an Anthropic API key and a project directory.

### 10. How to get started

Install with `npm install -g vibe-racer`, set your `ANTHROPIC_API_KEY`, and run your first task in under 5 minutes. The included example task lets you experience the full pipeline immediately. [Read the full guide](/getting-started).
