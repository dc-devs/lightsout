import { usageFixture } from '#tests/helpers/usageFixture.ts';

/**
 * Exactly what the CLI writes to stderr whenever it prints usage.
 *
 * `console.error(usage)` appends one newline and the text already ends in one,
 * so error output ends with two. Pinning the whole block is the point of
 * characterization: if a refactor changes it, the CLI suites go red and the
 * refactor is wrong.
 *
 * Built from `usageFixture` — a hand-written copy — rather than from the CLI's
 * own `usage`, which is now rendered from the command catalog. Reading the
 * subject to state the expectation would pin nothing. (A FEATURE adding a
 * command updates that fixture deliberately; its own note carries the dates.)
 */
export const usageStderr = `${usageFixture}\n`;
