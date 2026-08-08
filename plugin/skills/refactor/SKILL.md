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

1. Resolve the engine bundle: `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`. If the
   file does not exist, stop and tell the user to reinstall the plugin.
2. Run it with what the user gave you, nothing more:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" refactor
   ```

   Pass through when provided: `--path <subdir>`, `--all` (include baselined
   findings — burn-down mode), `--max-batches <n>`, `--cwd <path>`. To resume
   a parked run: `refactor --run <id>`.
3. Relay the engine's output verbatim — the per-batch outcomes, declines with
   rationale, and the burn-down table ARE the result. If batches were
   declined, tell the user each needs a human ruling: fix by hand or accept
   into the baseline (`lightsout standards-check --baseline`). The engine never commits
   — remind the user to review the working-tree diff and commit it.
