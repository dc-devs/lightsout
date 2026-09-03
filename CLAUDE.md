# lightsout

A lights-out software factory for coding agents: humans settle every decision
in the plan, then agents implement, test, and refactor unattended while
deterministic gates — the repo's own tests, lint, types, coverage — enforce
its standards. The engine is a code spine (gates, typed contracts, resumable
manifests, supervisor) that spawns the user's own installed harness
(Claude Code, Codex, OMP, Pi) to do the work. It makes agents accountable, not smarter.

## Guidelines

For all coding changes and diagnosis, only suggest or apply best-practice solutions. Never suggest a patch or a hack — only suggest changes with the long-term health of this codebase in mind.

Prefer correctness over speed of response.

## Linear Tickets and Git Branches
One ticket = one branch = one plan folder = one PR — follow the `ticket-workflow` skill, with `linear-ticket` for the Linear mechanics.
