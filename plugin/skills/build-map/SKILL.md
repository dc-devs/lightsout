---
name: build-map
description: Build or extend the lightsout traverse connection map by scanning repos for process-boundary edges. Use to bootstrap the map ("map node-a and node-b"), rescan after big changes, or verify the existing map. Scanning and joining are engine code; docs are only written after the user reviews the join.
allowed-tools: Bash, Read
---

# lightsout: build-map

**This skill is the ignition, not the engine.** Scanning, the join, and
authoring all live in the engine as deterministic code. Do not add workflow
steps to this file.

## Steps

1. Resolve the engine bundle: `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`. If the
   file does not exist, stop and tell the user to reinstall the plugin.
2. Scan and join:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" build-map <node...|all>
   ```

   Pass through `--connections <dir>` and `--rescan` when the user gives
   them. Nodes must exist in the map's `repos.yaml` — if one doesn't, ask
   the user for its clone URL (or `{ repo, path }` for a monorepo package)
   and add it there first.
3. Relay the classified join verbatim — it ends at the REVIEW GATE. The
   user culls `join.json` (rejecting false and fuzzy matches); do NOT run
   the author step until they say the review is done.
4. After their review: `build-map --author <run-id>`, and relay the result.
