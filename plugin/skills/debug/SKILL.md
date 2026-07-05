---
name: debug
description: Find the root cause of a cross-repo bug by following the data flow through the lightsout connection map. Use for "where does X break / get dropped / revert?" style bugs that span repos. Input is a symptom description and optionally a start node, a suspect commit, or a file:line hint. Investigates locally first, hops only on evidence, and returns the root cause + a proposed fix (or an honest gap).
allowed-tools: Bash, Read
---

# lightsout: debug

**This skill is the ignition, not the engine.** The worklist loop, budget,
bidirectional routing, halt-on-root-cause, and state all live in the engine as
deterministic code. Do not add workflow steps to this file.

## Steps

1. Resolve the engine bundle: `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`. If the
   file does not exist, stop and tell the user to reinstall the plugin.
2. Run it with what the user gave you, nothing more:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" debug "<symptoms>"
   ```

   Pass through when provided: `--start <node>` (else the seed is inferred
   from the current repo), `--at <file:line>` (narrow the first hop),
   `--suspect <hash>` (a commit to check first), `--budget <n>`,
   `--connections <dir>`. To resume a parked or budget-exhausted run:
   `debug --run <id>`.
3. Relay the engine's output verbatim — the hop chain, the root cause +
   proposed fix, and any gaps/drift ARE the answer's evidence. If gaps ended
   the trail, mention that `map-connection draft --run <id>` scaffolds the
   missing docs.
