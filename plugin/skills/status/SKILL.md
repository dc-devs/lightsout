---
name: status
description: Show what lightsout is doing right now — the run that is going, the queue's board and every active ticket on it, a plan being planned, a branch being shipped, or every recorded run. Use when the user asks how the queue is doing, what the run is up to, where a plan or a ship has got to, or simply for status.
allowed-tools: Bash
---

# lightsout: status

**This skill is the ignition, not the engine.** It holds no logic — no rule
about which views exist, which flags may sit together, or how a board is
drawn. All of that lives in the engine. This skill only runs the command and
posts what it wrote.

## Steps

1. Resolve the plugin root from this loaded skill's absolute path: it is two
   directories above this `SKILL.md`. In Claude Code,
   `${CLAUDE_PLUGIN_ROOT}` may provide the same path; do not assume that
   variable exists in Codex skill shell calls. Use the resolved absolute path
   wherever `<plugin-root>` appears below. Confirm
   `<plugin-root>/dist/cli.mjs` exists; otherwise stop and tell the user to
   reinstall the plugin or run `pnpm bundle` in the lightsout repo.
2. Decide the flags. Any status flags the user typed are forwarded
   **unchanged**. Plain words map to the matching flag:
   - asking about the queue → `--queue`
   - asking about a plan being planned → `--planning <name>`
   - asking about a branch being shipped → `--shipping <branch>`
   - asking to list every run → no flags at all
   - **no arguments at all → `--now`**, because showing what is going is why
     this skill exists.

   Carry no rule of your own about which flags may sit together. The engine
   owns every one of them and answers a contradictory pair with its own usage
   text, which step 4 posts.
3. Refuse `--watch` in one sentence: it belongs in a terminal, because it
   never exits and would hold this session. Do not strip it and show a
   snapshot instead — silently changing what was typed is worse than refusing
   it.
4. From the project directory, run the engine with **both streams captured
   together**:

   ```sh
   node "<plugin-root>/dist/cli.mjs" status <flags> 2>&1
   ```

   Post everything the command wrote into the conversation **verbatim**,
   whatever exit code it ended with — no commentary, no summary, no
   reformatting, and no sentence of your own wrapped around it. The engine
   owns the rendering, and it owns the refusals too: the usage text a
   contradictory flag pair earns, and the `several runs are going — pick one
   with --run <id>` lines, are both written to standard error beside a
   non-zero exit. A non-zero exit is not an error to report; it is the answer.

## What to tell the user if they ask

- **`--queue` answers at once.** `--wait` is the one that spends up to a
  minute, and it is for a queue that has only just been launched and has not
  taken the repository's run lock yet.
- **`--now` shows the run that is going**, printed once and never repainted.
  For a phased plan it shows both levels: the phase sequence first, then the
  phase moving now. With nothing going it falls back to the newest run, and
  when several unrelated runs are going it names their ids rather than
  guessing which one was meant.
- **The `queue` skill's ten-minute posts are separate.** Those arrive on their
  own while a queue drains; this skill is for asking by hand, at any moment,
  on any harness.
