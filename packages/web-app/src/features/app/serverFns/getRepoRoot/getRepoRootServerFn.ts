import { createServerFn } from '@tanstack/react-start';
import { getRepoRoot } from '#src/common/utils/getRepoRoot.ts';

/**
 * Which repo this app has open.
 *
 * The one server function that is not a `LightsoutReader` method: the root is
 * app configuration rather than run data, so the reader stays at four methods
 * and a hosted implementation never has to answer for it.
 */
export const getRepoRootServerFn = createServerFn({ method: 'GET' }).handler(async () => ({ repoRoot: getRepoRoot() }));
