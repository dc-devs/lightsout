# Monorepos

Whole-repository gates can make monorepo runs slower and less reliable. An unrelated broken package can block the pipeline, while coverage is measured across code that the current change never touched.

`package-gates` lets lightsout gate only the packages affected by a run. Each command template runs once per affected package, in parallel, with `{package}` replaced by the package’s `package.json` name:

```json
{
  "package-gates": {
    "check": "pnpm --filter {package} check",
    "test": "pnpm --filter {package} test:unit",
    "test-coverage": "pnpm --filter {package} test:coverage"
  }
}
```

Every template must include `{package}`. Commands that should run identically across the entire repository belong under `gates` instead.

If your workspace packages do not live in `packages/`, set `packages-dir`:

```json
{
  "packages-dir": "apps"
}
```

## How package gates work

**Affected packages are detected automatically.** Lightsout determines package scope from the finished plan and the files agents actually change. To set the scope explicitly, pass `--packages`:

```text
/implement plan.md --packages backend-api,shared
```

**A package name that does not exist is handled by where it came from.** Names lightsout reads out of the plan's prose are filtered down to directories that exist under the packages directory, and each name it drops is recorded in the run log. A scope you declared yourself — `--packages`, or a `packages:` list in the plan's front-matter — is not filtered: if it names a package that does not exist, the run stops before any gate runs and tells you which packages do exist.

**Packages only run the gates they support.** If a package does not define the script referenced by a template, that gate is skipped for the package and recorded in the run log. Documentation and infrastructure packages do not need placeholder scripts.

**Changes outside the packages directory still get verified.** Package-only changes run the affected-package templates. Root-only changes run the repository-wide commands configured under `gates`. Mixed changes also run only the repository-wide `gates`, rather than the affected-package templates too, because those root commands verify the whole repository.

**Dependent packages can be included.** Use your package manager’s dependent-package filtering syntax when you want changes to a shared package to also verify its consumers. With pnpm, for example:

```json
{
  "package-gates": {
    "check": "pnpm --filter ...{package} check",
    "test": "pnpm --filter ...{package} test:unit",
    "test-coverage": "pnpm --filter ...{package} test:coverage"
  }
}
```
