---
name: implement
description: Run the lightsout deterministic implementation pipeline on a plan file. Use when the user asks to implement a plan via lightsout.
allowed-tools: Bash, BashOutput, Read
---

# lightsout: implement

**This skill is the ignition, not the engine.** It contains no pipeline
logic — no gates, no retries, no state. All of that lives in the engine, where
it is deterministic code. Do not add workflow steps to this file.

## Steps

1. Resolve the plugin root from this loaded skill's absolute path: it is two
   directories above this `SKILL.md`. In Claude Code,
   `${CLAUDE_PLUGIN_ROOT}` may provide the same path; do not assume that
   variable exists in Codex skill shell calls. Use the resolved absolute path
   wherever `<plugin-root>` appears below. Confirm
   `<plugin-root>/dist/cli.mjs` exists; otherwise stop and tell the user to
   reinstall the plugin or run `pnpm bundle` in the lightsout repo.
2. Run it on the plan path the user provided, **in the background**, so the
   session is free while the run works:

   ```sh
   node "<plugin-root>/dist/cli.mjs" implement --plan "<plan-path>"
   ```

   Pass through what the user gave you, nothing more:
   - a plan **folder** → hand it straight through as `--plan "<folder>"`; the
     engine branches on what the folder holds (an `overview.md` runs every
     phase in order, otherwise the folder's `plan.md` runs on its own)
   - a starting phase the user asked for → `--start-phase <n>`
   - a high-level/overview plan for a single-phase run → `--overview "<path>"`
   - an explicit package scope → `--packages a,b`
   - `resume` requests → `node "<plugin-root>/dist/cli.mjs" resume --run <id>`

3. Start a watch on the run, also in the background:

   ```sh
   node "<plugin-root>/dist/cli.mjs" status --watch
   ```

   With no `--run` it follows the run just started, waiting for it to appear,
   and paints a fresh block every two minutes until the run stops — then it
   exits on its own.

   Now relay it, in a loop, until that watch command has exited:

   1. Read the watch's new output.
   2. Every complete block it has produced since the last read goes into the
      conversation **verbatim** — no commentary, no summary, no reformatting,
      nothing between one block and the next. The engine owns that rendering;
      the skill only carries it.
   3. A read that returns nothing new means the next repaint has not happened
      yet. Say nothing and read again.

   Do not go on to the final report while the watch is still running: the
   engine run has not finished, and there is no report yet.

4. Relay the engine's final report to the user verbatim — it is waiting in the
   backgrounded run from step 2, which has finished by the time the watch
   exited. If the run parked itself (rate-limit pause or escalation), tell the
   user the run id and that `resume` will continue it — the same run id also
   resumes a multi-phase run, picking up at the phase that stopped.

## What the engine does to the ticket

Stated so nobody adds a step for it here — the engine already does it:

- Before the pipeline starts, `lightsout implement` records the ticket's
  planning status and moves the ticket to In Progress. `lightsout
  implement-direct` does the same, resolving the ticket from `--ref` or from
  the branch. The run refuses to start when either write fails, because
  required state must be recorded before source work begins.
- The planning status it records: `planning-complete` and
  `planning-not-needed` are preserved as they stand. Anything else —
  `planning-ready-auto-plan`, either `planning-needs-*` value, no label at all,
  or more than one — is written as `planning-complete`.
- When the plan carries an acceptance-test ledger, the engine writes those
  tests first, locks them, and the run is not done until every one of them
  passes in the gate run beside the gates. Nothing in this skill triggers that;
  the plan's own ledger is what turns the step on.
- Nothing in this skill performs those writes. Do not add a step for them.
