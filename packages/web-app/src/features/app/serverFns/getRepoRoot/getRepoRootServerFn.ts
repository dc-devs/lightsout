import { createServerFn } from '@tanstack/react-start';
import { findRepoRoot } from '#src/common/utils/findRepoRoot.ts';

/**
 * Which repo this app has open, or `undefined` when none was found.
 *
 * The one server function that is not a `LightsoutReader` method: the root is
 * app configuration rather than run data, so the reader stays at four methods
 * and a hosted implementation never has to answer for it.
 *
 * `undefined` is the signal the shell reads to leave the "Your repo" zone out
 * entirely, which is what makes a build with no repo on disk a coherent site
 * rather than a set of empty pages.
 */
export const getRepoRootServerFn = createServerFn({ method: 'GET' }).handler(async () => ({ repoRoot: findRepoRoot() }));
