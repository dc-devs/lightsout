---
name: refactor
description: Burn down a repo's standards-check findings (duplication, size, structure, boundary violations) in verified, resumable batches via the lightsout refactor pipeline. Use when the user asks to refactor toward the standards, clean up standards-check findings, or burn down code debt. Requires a lightsout.config.json (gates) and a clean git tree.
allowed-tools: Bash, Read
---

# lightsout: refactor

**This skill is the ignition, not the engine.** Work-list computation,
batching, gates, retries, decline tracking, parking, and resume all live in
the engine as deterministic code. Do not add workflow steps to this file.

## Steps

1. Resolve the plugin root from this loaded skill's absolute path: it is two
   directories above this `SKILL.md`. In Claude Code,
   `${CLAUDE_PLUGIN_ROOT}` may provide the same path; do not assume that
   variable exists in Codex skill shell calls. Use the resolved absolute path
   wherever `<plugin-root>` appears below. Confirm
   `<plugin-root>/dist/cli.mjs` exists; otherwise stop and tell the user to
   reinstall the plugin.
2. Run it with what the user gave you, nothing more:

   ```sh
   node "<plugin-root>/dist/cli.mjs" refactor
   ```

   Pass through when provided: `--path <subdir>`, `--all` (include baselined
   findings — burn-down mode), `--max-batches <n>`, `--code-checks` (skip each
   batch's agent review — deterministic checks only), `--allow-dirty` (accept
   uncommitted changes as baseline instead of demanding a clean tree),
   `--cwd <path>`. To resume a parked run: `refactor --run <id>`.
3. Read the exit code before anything else. `0` finished. `2` stopped with
   work left and can be picked up: the run hit `--max-batches` or a harness
   rate limit, and its last printed line says how to resume — this is not a
   failure, report it as progress. Anything else is a failure.
4. Relay the engine's output verbatim — the per-batch outcomes, declines with
   rationale, and the burn-down table ARE the result. If batches were
   declined, tell the user each needs a human ruling: fix by hand or accept
   into the baseline (`lightsout standards-check --baseline`). The engine never commits
   — remind the user to review the working-tree diff and commit it.
