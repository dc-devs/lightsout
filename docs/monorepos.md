# Monorepos

Whole-repo gates on a monorepo mean an unrelated red package blocks every
run, and the coverage bar applies to the entire repo. `packageScripts` fixes
both: command templates that run once per affected package, in parallel, with
`{package}` replaced by that package's `package.json` name:

```json
{
	"packageScripts": {
		"check": "pnpm --filter {package} typecheck",
		"testUnit": "pnpm --filter {package} test:unit",
		"testCoverage": "pnpm --filter {package} test:coverage"
	}
}
```

Every `packageScripts` command must contain `{package}` — one without it
would run identically for every package and belongs in `scripts.*` instead
(config validation rejects it).

Not every package in scope has to define every script. When a template's
`run <script>` names a script a package's `package.json` doesn't have, that
gate is **skipped** for that package — announced live
(`gate [infra-local] check: skipped (no "check" script)`) and recorded in
`commands.jsonl` with `skipped: true`, so an infra or docs package pulled
into scope never needs placeholder scripts. A package missing only the
coverage script falls back to its plain test script. Templates the engine
can't read a script name from (no `run` token) always execute.

## Package scope

The run's **package scope** resolves through a four-tier chain, so
`/implement plan.md` needs nothing extra:

1. `--packages backend-api,shared` on the CLI — explicit override
2. Plan front-matter — precise and authoritative when present:

   ```markdown
   ---
   packages:
     - backend-api
   ---
   # Plan: ...
   ```

3. **Derived from the plan body** — concrete `packages/<name>/` paths the
   plan references become the scope (recorded in the manifest and the run
   report as `plan-paths`, so a derived scope is never mistaken for a
   declared one). This is why plans from tools that know nothing about
   lightsout — plan mode output, hand-written plans — just work. Safe in
   both directions: a package mentioned only as context merely runs extra
   gates, and a missed one is caught by scope expansion below.
4. Hard error — the plan names no packages at all, which usually means it's
   too vague to implement anyway.

After the implement step, changed files are the truth: the scope widens
automatically when the agent touches a package the scope missed (never
shrinks). Files outside `packagesDir` re-activate the whole-repo `scripts.*`
as a "root group". Tip: use a dependents filter in the templates
(`pnpm --filter ...{package}`) to also verify packages that depend on the
changed ones — the blast radius lives in your template, not in the engine.
