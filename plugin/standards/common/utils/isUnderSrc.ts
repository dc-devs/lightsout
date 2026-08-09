import { getDirectory } from './getDirectory.ts';

interface Params {
	/** A repo-relative file or folder path. */
	path: string;
}

/**
 * Whether a path's own folder sits anywhere under a `src` segment.
 *
 * Every location rule of the unit-testing document is anchored this way:
 * outside `src/`, the very folder names those rules refuse — `tests/`,
 * `fixtures/`, `mocks/` — are the sanctioned test-support locations the same
 * document names.
 */
export const isUnderSrc = ({ path }: Params): boolean => getDirectory({ path }).split('/').includes('src');
