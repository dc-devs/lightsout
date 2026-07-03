---
name: implement
description: Run the lightsout deterministic implementation pipeline on a plan file. Use when the user asks to implement a plan via lightsout.
allowed-tools: Bash, Read
---

# lightsout: implement

**This skill is the ignition, not the engine.** It contains no pipeline
logic — no gates, no retries, no state. All of that lives in the engine, where
it is deterministic code. Do not add workflow steps to this file.

## Steps

1. Resolve the engine bundle: `${CLAUDE_PLUGIN_ROOT}/../dist/cli.mjs`
   (the plugin lives in `plugin/`; the bundle is committed at the repo root).
   If the file does not exist, stop and tell the user to run `pnpm bundle`
   in the lightsout repo (pre-alpha builds are not yet committed).
2. Run it with the plan path the user provided:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/../dist/cli.mjs" run "<plan-path>"
   ```

3. Relay the engine's final report to the user verbatim. If the run parked
   itself (rate-limit pause or escalation), tell the user the run id and that
   `resume` will continue it.
