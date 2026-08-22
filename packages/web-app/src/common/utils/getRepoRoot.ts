import { findRepoRoot } from '#src/common/utils/findRepoRoot.ts';

/**
 * The repo whose `.lightsout/` this app reads, with the working directory
 * standing in when no repo was found.
 *
 * The fallback is the whole difference from `findRepoRoot`, which answers
 * "was one found at all" and is what the navigation and the reader switch read.
 * A reader still needs a directory to point at even when the answer is no, and
 * an empty run list read from the working directory is what it then reports.
 */
export const getRepoRoot = (): string => findRepoRoot() ?? process.cwd();
