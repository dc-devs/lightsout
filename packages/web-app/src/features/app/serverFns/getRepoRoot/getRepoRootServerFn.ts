import { createServerFn } from '@tanstack/react-start';
import { requireLocalRepoRoot } from '#src/common/utils/requireLocalRepoRoot.ts';

/**
 * Which repo `/app` has open.
 *
 * The one server function that is not a `LightsoutReader` method: the root is
 * app configuration rather than run data, so the reader never has to answer
 * for it. It still passes the same gate the reader does — the path is this
 * machine's disk, which the public site never shows.
 *
 * @throws {NotFoundError} On the public site.
 * @throws {Error} Locally, when no repo was found.
 */
export const getRepoRootServerFn = createServerFn({ method: 'GET' }).handler(async () => ({ repoRoot: requireLocalRepoRoot() }));
