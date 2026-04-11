# vibe-racer

**Your AI race engineer. Five laps from objective to shipped code — you call the pit stops.**

---

## Top 10 Key Takeaways

1. **Your project is the car.** Every feature, bug fix, or refactor starts as a task — a car entering the race.

2. **Five laps, five documents.** Objective → Product → Design → Plan → Execute. Each lap produces a spec that feeds the next.

3. **You call the pit stops.** At the end of every lap, the car pulls into the pit box. You review the work, edit what you disagree with, and signal when it's ready to go again.

4. **The race engineer does the heavy lifting.** A Claude-powered agent generates product questions, writes specs, designs architecture, builds implementation plans, and executes code — milestone by milestone.

5. **Answers come pre-filled.** The race engineer recommends answers to every question. You only edit disagreements, not blank forms.

6. **Security is built into the pit lane.** Path containment, bash filtering, sensitive-path blocklists, and pre-commit secret scanning run on every session. An append-only audit log captures every denied operation.

7. **Git-native from start to finish.** Each task gets its own branch. Commits happen after every lap. No push — you control when and where code merges.

8. **Small tasks take the fast lane.** Trivial tasks can skip the product and design laps entirely, going straight from objective to plan.

9. **Radio calls keep you in the loop.** If the race engineer needs more information mid-lap, it appends follow-up questions and hands control back to you — up to three rounds per pit stop.

10. **Built on the Claude Code SDK.** vibe-racer orchestrates Claude sessions with the `claude_code` preset, giving the agent full coding capabilities within a guarded sandbox.

---

## Get Started

```bash
vibe-racer init            # set up in your project
vibe-racer new "my task"   # create a task
vibe-racer drive           # hand the car to the race engineer
```

---

See the [README](README.md) for full documentation, commands, and configuration.
