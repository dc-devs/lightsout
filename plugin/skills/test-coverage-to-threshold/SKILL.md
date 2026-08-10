---
name: test-coverage-to-threshold
description: Raise a repo's unit-test coverage until its own coverage script passes, in verified, resumable batches via the lightsout coverage pipeline. Use when the user asks to raise test coverage, get coverage to the threshold, or make the coverage gate pass. Requires a lightsout.config.json (gates) and a clean git tree.
allowed-tools: Bash, Read
---

# lightsout: test-coverage-to-threshold

**This skill is the ignition, not the engine.** Measuring, batching, gates,
retries, set-aside tracking, parking, and resume all live in the engine as
deterministic code. Do not add workflow steps to this file.

## Steps

1. Resolve the engine bundle: `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`. If the
   file does not exist, stop and tell the user to reinstall the plugin.
2. Run it with what the user gave you, nothing more:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" test-coverage-to-threshold
   ```

   Pass through when provided: `--max-batches <n>`, `--cwd <path>`. To resume
   a parked run: `test-coverage-to-threshold --run <id>`.
3. Relay the engine's output verbatim — the per-batch outcomes, the set-aside
   files with their reasons, and the before → after coverage table ARE the
   result. If files were set aside, tell the user each needs a human: they
   likely need source changes before they can be tested. The engine never
   commits — remind the user to review the working-tree diff and commit it.
