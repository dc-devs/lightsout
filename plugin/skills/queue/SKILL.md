---
name: queue
description: Start the lightsout queue — drain the tracker of automatable tickets in parallel worktrees, shipping a PR per ticket. Use when the user asks to start the queue, drain the tickets, run the ticket queue, or work the backlog lights-out. Requires `queue` and `ticket-tracker` blocks in lightsout.config.json and the configured tracker credentials in the environment.
allowed-tools: Bash, Read, Write, Glob
---

# lightsout: queue

**This skill is the ignition, not the engine.** It contains no queue logic —
no ticket selection, no worktrees, no shipping. All of that lives in the
engine, where it is deterministic code. Do not add workflow steps to this file.

## Steps

1. Resolve the plugin root from this loaded skill's absolute path: it is two
   directories above this `SKILL.md`. In Claude Code,
   `${CLAUDE_PLUGIN_ROOT}` may provide the same path; do not assume that
   variable exists in Codex skill shell calls. Use the resolved absolute path
   wherever `<plugin-root>` appears below. Confirm
   `<plugin-root>/dist/cli.mjs` exists; otherwise stop and tell the user to
   reinstall the plugin or run `pnpm bundle` in the lightsout repo.
2. Read the top-level `ticket-tracker` block — connection keys never live in
   `queue`. Confirm the environment variable named by
   `ticket-tracker.api-key-env` holds a value. For Jira, also confirm the
   variable named by `ticket-tracker.api-user-email-env` holds the account
   email. If a required variable is empty, stop and say which variable to set
   — the engine's own refusal would otherwise arrive minutes later in a
   background log.
3. Start the queue in the background, relaying questions through the mailbox
   rather than a terminal:

   ```sh
   node "<plugin-root>/dist/cli.mjs" queue --file-relay
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
   holds `ticket`, `title`, `question` and `askedAt` — and put the complete
   ticket context and question in the final response that waits for the user's
   answer, never only in commentary. When they answer, write the answer beside
   it as a sibling file: same stem,
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

- **Which tickets it takes:** tickets in the configured tracker scope — a
  Linear team or Jira project — whose planning-status label and tracker status
  form one of three pairs:
    - `planning-ready-auto-plan` in Backlog → the auto-plan worker plans the
      ticket first, then builds the plan it wrote.
    - `planning-complete` in Ready to implement → the plan worker builds the
      plan already published to the ticket, fetching it when the worktree does
      not have it. When no plan is attached — a brainstorm that finished all
      shaping without writing one — it builds from the ticket body instead,
      because `planning-complete` promises finished shaping, not a plan folder.
    - `planning-not-needed` in Ready to implement → the direct worker builds
      straight from the ticket body.

  The last two are different workers on purpose: a `planning-complete` ticket
  has a graded plan attached, and building it from the ticket body instead
  would throw that plan away. Every other combination is left alone, and the
  planning-status label is how a human opts a ticket in. A ticket with a
  blocking ticket that is not finished — done or canceled — is not picked up;
  it is left behind naming the blocker, and the same run takes it as soon as
  the blocker ships.
- **Two planning-status labels is a skip:** a ticket carrying more than one is
  skipped with a sentence naming every planning-status label it carries.
  Exactly one is the model's rule, so two is a human error the queue will not
  resolve by guessing.
- **A missing label refuses the run at startup:** before any ticket is picked
  up, the queue checks that every configured planning-status label exists in
  the tracker, and refuses naming the missing one. It refuses the same way when
  `queue.ready-status` is not among `queue.eligible-statuses`, because the two
  build pairs could then never match and the drain would report an empty
  backlog instead of a broken config.
- **Already-merged work is reconciled, not rebuilt:** before a worktree is
  created, the queue asks the forge whether the ticket's branch already has a
  merged pull request. A confirmed merge moves the ticket to Done and skips the
  worker. A parked worktree for that branch is removed when its tree is clean,
  and kept with a progress line when it is dirty.
- **How it runs them:** each ticket gets its own fresh git worktree, the
  config's `setup` command, and a harness run; finished branches ship as PRs.
  Up to `max-parallel` tickets run at once. The queue works in waves —
  everything unblocked runs and ships, then it re-reads the tracker and takes
  whatever the finished work just unblocked, stopping when a re-read finds
  nothing new.
- **Exit codes:** 0 — everything eligible shipped. 2 — work remains that a
  re-run picks up (parked or left-behind tickets). 1 — the queue refused to
  start; the message says why.
- **Answers are never lost:** an answer written to the mailbox is recorded in
  the queue run's decisions file and onto the ticket before the worker acts
  on it — the same guarantee, whichever channel carried it.
- **The parked label:** when the config sets `parked-label`, a parked ticket
  carries that label in the tracker and loses it when the ticket resumes or
  ships.
- **Tracker writes gate the work:** before a worker touches source, the queue
  records the ticket's planning status and moves it to In Progress. A failed
  write parks that one ticket and leaves every other worker running. After a
  merge is confirmed the ticket moves to Done; a failed Done write leaves the
  ship recorded as successful and reports a separate reconciliation failure in
  the drain report, because a tracker failure cannot undo a merge.
