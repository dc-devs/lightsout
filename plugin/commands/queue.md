---
description: 'Start the lightsout queue — drain the tracker of automatable tickets in parallel worktrees, shipping a PR per ticket. Use when the user asks to start the queue, drain the tickets, run the ticket queue, or work the backlog lights-out. Requires `queue` and `ticket-tracker` blocks in lightsout.config.json and the configured tracker credentials in the environment.'
---
<!-- generated:lightsout-command -->

Load the lightsout `queue` skill and follow it exactly as if the user had invoked it directly — on the pi-family harnesses (omp, pi) read `skill://queue`; in Claude Code open the `queue` skill from your skills list.

User input: $ARGUMENTS
