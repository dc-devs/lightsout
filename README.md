# lightsout

> Lights-out manufacturing: a factory so reliable it runs with the lights off.

**lightsout** is a deterministic engine for coding agents. It does not make your
agent smarter — it makes your agent *accountable*: mechanical gates, typed
contracts, resumable run state, and a supervisor for the exception path. The
agents do the work; the engine makes sure the work is verified when nobody is
watching.

**Status: pre-alpha.** Design lives in [docs/architecture.md](docs/architecture.md).

## Principles

- **Verification appreciates, constraint depreciates.** Every rule that tells a
  model *how to think* loses value with each model release. Gates, contracts,
  and state never do.
- **Thin shell.** If a piece of the engine exists to make the model smarter,
  cut it. If it exists to make the model accountable, keep it forever.
- **BYO harness.** The engine drives your installed coding agent (Claude Code,
  Codex) through a driver interface. It never handles model credentials, and it
  rides your existing subscription.
- **State on disk.** Every run writes a manifest. Crashed or rate-limited runs
  resume where they stopped.

## Development

```sh
pnpm install
pnpm check    # typecheck
pnpm bundle   # build dist/cli.mjs (committed — see .gitignore note)
```

## Distribution

No npm. The repo is both the engine and a Claude Code plugin — the wrapper
skill invokes the committed bundle. Non-plugin consumers (Codex, CI) use
`git clone` + `node dist/cli.mjs`.

## License

[MIT](LICENSE)
