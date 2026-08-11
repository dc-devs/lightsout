# Agent prompts

One markdown file per agent role (feature-executor, unit-test-writer,
refactor-executor, supervisor). Each prompt's output section must match the
role's zod contract in `src/` — the engine rejects and retries anything that
doesn't validate.

Written fresh for lightsout's typed-contract interface — these are not ports.
