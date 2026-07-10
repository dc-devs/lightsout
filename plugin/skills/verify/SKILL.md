---
name: verify
description: Run the lightsout stateless one-shot verification on the current dirty working tree — scoped gates, read-only scan detectors, and a missing-test check, emitting one typed report whose verdict rides the exit code. Use when the user wants to spot-check an in-progress change against the standards before committing, without running the full pipeline.
allowed-tools: Bash, Read
---

# lightsout: verify

**This skill is the ignition, not the engine.** It contains no logic — no
gates, no scan detectors, no scope derivation, no verdict computation. All of
that lives in the engine, where it is deterministic code. `verify` itself is
read-only and stateless: it never edits source, never loops, never keeps a
run id or manifest. Do not add workflow steps to this file.

## Steps

1. Resolve the engine bundle: `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`
   (the bundle ships inside the plugin — marketplace installs copy only the
   plugin directory, never the surrounding repo). If the file does not
   exist, stop and tell the user to reinstall the plugin or run
   `pnpm bundle` in the lightsout repo.
2. Run it against the current working tree:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" verify
   ```

   Pass through what the user gave you, nothing more:
   - a different repo root → `--cwd <path>`
   - a base ref for the changed-file diff → `--base <ref>`
   - skip the coverage gate → `--skip-coverage`

3. Relay the engine's output verbatim — the findings, missing-test flags,
   advisories, and the verdict line ARE the result. The verdict rides the
   exit code: **0** clean, **1** red (any gate red, any scan finding touching
   the diff, any missing test), **2** environment error (no config, not a git
   repo, bad `--base` ref). The full report is written to
   `.lightsout/verify.json`. Any looping ("run verify after each change until
   clean") is the user's usage, not this skill's — do not loop it yourself.
