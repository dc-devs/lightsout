---
name: queue
description: Start the lightsout queue — drain the tracker of automatable tickets in parallel worktrees, shipping a PR per ticket. Use when the user asks to start the queue, drain the tickets, run the ticket queue, or work the backlog lights-out. Requires a `queue` block in lightsout.config.json and the tracker API key in the environment.
allowed-tools: Bash, Read, Write, Glob
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
2. Check the tracker API key is set: read the config's `api-key-env` value
   from `lightsout.config.json` and confirm that environment variable holds
   something. If it does not, stop and say which variable to set — the
   engine's own refusal would otherwise arrive minutes later in a background
   log.
3. Start the queue in the background, relaying questions through the mailbox
   rather than a terminal:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" queue --file-relay
   ```

   Run it with the Bash tool in the background — the harness notifies the
   session when a background command exits. Tell the user it has started and
   that they can keep working; questions will come to them here.
4. Watch the mailbox at `.lightsout/queue/relay` under the repo root — the
   path the engine prints on startup — with a **watcher of its own**: a
   second background Bash command that polls every 15 seconds and exits as
   soon as either a file matching `*.question.json` exists or the queue
   process has ended, e.g.

   ```sh
   while [ -z "$(ls .lightsout/queue/relay/*.question.json 2>/dev/null)" ] && kill -0 <queue-pid> 2>/dev/null; do sleep 15; done
   ```

   Because both the queue and the watcher run in the background, the session
   stays free for the user between events; the watcher exiting is what wakes
   the session. (A harness with a dedicated wait-on-condition tool may use it
   in place of the shell loop — same cadence, same two wake conditions.)
5. When the watcher wakes the session: read each `*.question.json` file — it
   holds `ticket`, `title`, `question` and `askedAt` — and put the question
   to the user with the ticket reference and title as context. When they
   answer, write the answer beside it as a sibling file: same stem,
   `.answer.json` instead of `.question.json`, holding
   `{"answer": "<what the user said>"}`. The engine picks it up within two
   seconds, deletes both files, and the worker continues. Then re-start the
   watcher (step 4) and give the session back to the user.
6. A question the user does not answer parks its ticket once the config's
   `question-timeout` elapses (default one hour). Say so if they ask; a later
   drain picks parked work back up.
7. When the queue's own background command exits, stop any running watcher
   and relay the report verbatim: one line per ticket — shipped, parked with
   the reason and its worktree path, or left behind with why.

The bare `node "<absolute path to cli.mjs>" queue` command still exists for
anyone who would rather hold their own terminal, where questions are asked on
stdin instead.

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
- **Answers are never lost:** an answer written to the mailbox is recorded in
  the queue run's decisions file and onto the ticket before the worker acts
  on it — the same guarantee, whichever channel carried it.
- **The parked label:** when the config sets `parked-label`, a parked ticket
  carries that label in the tracker and loses it when the ticket resumes or
  ships.
