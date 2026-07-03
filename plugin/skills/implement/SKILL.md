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

1. Resolve the engine bundle: `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`
   (the bundle ships inside the plugin — marketplace installs copy only the
   plugin directory, never the surrounding repo). If the file does not
   exist, stop and tell the user to reinstall the plugin or run
   `pnpm bundle` in the lightsout repo.
2. Run it on the plan path the user provided:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" run --plan "<plan-path>"
   ```

   Pass through what the user gave you, nothing more:
   - a high-level/overview plan for a phased run → `--overview "<path>"`
   - an explicit package scope → `--packages a,b`
   - `resume` requests → `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" resume --run <id>`

3. Relay the engine's final report to the user verbatim. If the run parked
   itself (rate-limit pause or escalation), tell the user the run id and that
   `resume` will continue it.
