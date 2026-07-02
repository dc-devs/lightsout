# Fixture: toy-calc

Live-e2e consumer fixture. `plans/power.md` is intentionally unimplemented —
it's the runnable quick-start plan; the other plans were implemented by past
engine runs and exist as reference.

```sh
node ../../dist/cli.mjs run --plan plans/power.md --cwd .
```

Run state lands in `.lightsout/runs/` (gitignored at repo root). A successful
run implements the plan — reset with `git checkout -- fixtures/toy-calc` (and
delete untracked files it created) to make it runnable again.
