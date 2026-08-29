---
name: queue
description: Start the lightsout queue — drain the tracker of automatable tickets in parallel worktrees, shipping a PR per ticket. Use when the user asks to start the queue, drain the tickets, run the ticket queue, or work the backlog lights-out. Requires a `queue` block in lightsout.config.json and the tracker API key in the environment.
allowed-tools: Bash, Read
---

# lightsout: queue

**This skill is the ignition, not the engine.** It contains no queue logic —
no ticket selection, no worktrees, no shipping. All of that lives in the
engine, where it is deterministic code. Do not add workflow steps to this file.

## Steps

1. Resolve the engine bundle: `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`
   (the bundle ships inside the plugin — marketplace installs copy only the
   plugin directory, never the surrounding repo). If the file does not
   exist, stop and tell the user to reinstall the plugin or run
   `pnpm bundle` in the lightsout repo.
2. The queue is long-running and interactive: it holds the terminal that
   started it, and when a worker hits a question only a person can answer,
   the question is asked **on that terminal**. So the right home for it is a
   terminal the user watches, not a tool call. Print the resolved command —
   the absolute bundle path, not the `${CLAUDE_PLUGIN_ROOT}` variable — and
   tell the user to run it from the repo root in a dedicated terminal:

   ```sh
   node "<absolute path to cli.mjs>" queue
   ```

   Remind them the tracker API key (the config's `api-key-env` variable)
   must be set in that shell.
3. Only if the user explicitly asks you to run it anyway, run the same
   command with the Bash tool in the background — and say what that trades
   away first: with no terminal attached, any worker question cannot be
   answered, and that ticket parks with "there is no terminal to answer on".
   A later drain picks parked work back up.
4. When a run you started finishes, relay its report verbatim: one line per
   ticket — shipped, parked with the reason and its worktree path, or left
   behind with why.

## What to tell the user if they ask

- **Which tickets it takes:** tickets on the configured team, in an eligible
  status (by default Backlog or Ready to implement), carrying one of the two
  route labels the config maps — the direct route builds straight from the
  ticket body, the auto-plan route plans it first.
- **How it runs them:** each ticket gets its own fresh git worktree, the
  config's `setup` command, and a harness run; finished branches ship as PRs.
  Up to `max-parallel` tickets run at once.
- **Exit codes:** 0 — everything eligible shipped. 2 — work remains that a
  re-run picks up (parked or left-behind tickets). 1 — the queue refused to
  start; the message says why.
- **Answers are never lost:** an answer typed at the terminal is written to
  the queue run's decisions file and onto the ticket before the worker acts
  on it.
