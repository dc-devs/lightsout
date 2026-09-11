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

   Then post the launch snapshot. Run, in the foreground:

   ```sh
   node "<plugin-root>/dist/cli.mjs" status --queue
   ```

   It may wait up to a minute for the queue run to appear. Post its output
   into the conversation **verbatim** — no commentary, no summary, no
   reformatting. The engine owns that rendering: a board of seven columns
   (a markdown table), then one fenced status block per active ticket. The
   skill only carries it. Record the **next update time** as an absolute
   time ten minutes after this post, as epoch seconds:

   ```sh
   echo $(( $(date +%s) + 600 ))
   ```

   Also create an empty **relayed list** — a file that holds the name of each
   question file already posted, one name per line. Keep it outside the
   mailbox folder, which the engine owns and empties:

   ```sh
   mktemp
   ```

   If the queue's background command has already exited by now, skip to
   step 7.
4. Watch the mailbox at `.lightsout/queue/relay` under the repo root — the
   path the engine prints on startup — with a **watcher of its own**: a
   second background Bash command that polls every 15 seconds and exits as
   soon as one of three things holds:
   - a `*.question.json` file exists whose name is not in the relayed list;
   - the clock has reached the stored next update time;
   - the queue process has ended.

   For example, with the stored values put in place of the placeholders:

   ```sh
   while kill -0 <queue-pid> 2>/dev/null && [ "$(date +%s)" -lt <next-update-epoch> ]; do
     new=""
     for file in .lightsout/queue/relay/*.question.json; do
       [ -e "$file" ] && ! grep -qxF "$(basename "$file")" "<relayed-list>" && new="$file"
     done
     [ -n "$new" ] && break
     sleep 15
   done
   ```

   Because both the queue and the watcher run in the background, the session
   stays free for the user between events; the watcher exiting is what wakes
   the session. (A harness with a dedicated wait-on-condition tool may use it
   in place of the shell loop — same cadence, same three wake conditions.)
5. When the watcher wakes the session, check which conditions hold:
   - **The next update time has been reached:** run
     `node "<plugin-root>/dist/cli.mjs" status --queue`, post its output
     verbatim, and set the next update time to ten minutes after this post.
   - **A question file not yet relayed exists:** read it — it holds `ticket`,
     `title`, `question` and `askedAt` — and put the complete ticket context
     and question in the response, never only in commentary. Add its file
     name to the relayed list. A question neither resets the update clock nor
     waits for it.
   - **Both are due:** the complete `status --queue` output comes first and
     the question block last, in the same response.

   Any post made while a relayed question is still unanswered ends with that
   question's complete block again, after the board, so the response that
   waits for the user always carries the whole question.

   Then re-start the watcher (step 4) at once, with the kept next update time,
   and give the session back to the user. Do not wait for an answer: the
   ten-minute posts continue while a question is open, because the other
   workers keep running.

   When the user answers, write the answer beside the question as a sibling
   file: same stem, `.answer.json` instead of `.question.json`, holding
   `{"answer": "<what the user said>"}`. The engine picks it up within two
   seconds, deletes both files, and the worker continues. Drop that question's
   file name from the relayed list, then re-start the watcher (step 4) with
   the kept next update time.
6. A question the user does not answer parks its ticket once the config's
   `question-timeout` elapses (default one hour). Say so if they ask; a later
   drain picks parked work back up.
7. When the queue's own background command exits, stop any running watcher
   and relay the queue's final output verbatim, from the finished board —
   headed `Queue finished` — through the report lines after it: one line per
   ticket — shipped, parked with the reason and its worktree path, or left
   behind with why. Post no further `status --queue` updates.

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
      not have it. When no plan is attached it builds from **the ticket body**
      instead, because `planning-complete` promises finished shaping, not a plan
      folder. Two routes reach that: a brainstorm that finished all shaping
      without writing a plan, and the brainstorm's ready-to-implement outcome,
      which writes `planning-complete` and Ready to implement itself. In both
      cases the worker reads the ticket body — not the brainstorm files the
      ticket carries, which are the durable record a person reads and the input
      planning fetches.
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
- **The ten-minute posts:** at launch and then every ten minutes, this
  session posts the output of `lightsout status --queue`. First comes a board
  with seven columns — Build Queue, Building, Ship Queue, Shipping Now,
  Shipped, Parked and Blocked — where each ticket sits in the one column it is
  in now, so tickets move across the columns from one post to the next. Below
  the board is a detail block for each active ticket: one that is building,
  shipping, or waiting for an answer. A detail block is exactly what
  `lightsout status` prints for that ticket's run, planning or ship in its
  worktree. This is separate from the implement skill's two-minute watch,
  which follows a single run.
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
