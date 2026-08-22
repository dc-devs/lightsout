# shadcn/ui — vendored

This folder is written by the shadcn CLI (`pnpm dlx shadcn@latest add <component>`),
which `packages/web-app/components.json` points here. Nothing in it is authored
by hand as a matter of course.

It is listed under `vendored` in `lightsout.config.json`, so the standards never
judge it, no test is written for it, and no refactor pass restructures it — its
conventions are shadcn's, not this repo's. A change made here is still recorded
as a changed file, because there is no generating source in this repo to point
at instead.

`packages/web-app/jest.config.cjs` excludes it from the coverage threshold for
the same reason. The engine's exclusion covers the engine's own checks; a
coverage gate belongs to the test runner.

Components this app writes itself live in `src/appUI/` and are imported through
that module's barrel.
