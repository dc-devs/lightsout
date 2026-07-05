---
name: traverse
description: Answer a question that spans multiple repos by following data flow through the lightsout connection map ("where does field X end up?", "which backend op does the web-app call?"). Input is a question, a starting edge or node, and optionally the data-of-interest or a hop budget. For root-causing a bug across repos, use the `debug` skill instead.
allowed-tools: Bash, Read
---

# lightsout: traverse

**This skill is the ignition, not the engine.** The worklist loop, budget,
state, and routing all live in the engine as deterministic code. Do not add
workflow steps to this file.

## Steps

1. Resolve the engine bundle: `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`. If the
   file does not exist, stop and tell the user to reinstall the plugin.
2. Run it with what the user gave you, nothing more:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" traverse "<question>" --start <edge-or-node>
   ```

   Pass through when provided: `--budget <n>`, `--data "<field>"`,
   `--connections <dir>`. To resume a parked or budget-exhausted run:
   `traverse --run <id>`.
3. Relay the engine's output verbatim — the hop chain, gaps, and drift ARE
   the answer's evidence. If gaps were reported, mention that
   `map-connection draft --run <id>` scaffolds the missing docs.
