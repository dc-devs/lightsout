import { getDirectory } from './getDirectory.ts';

/** `src/feature` + `./thing` flattened to `src/feature/thing`, `..` segments included. */
const joinPath = ({ from, specifier }: { from: string; specifier: string }) => {
	const segments: string[] = [];

	for (const segment of `${from}/${specifier}`.split('/')) {
		if (segment === '..') {
			segments.pop();
		} else if (segment !== '' && segment !== '.') {
			segments.push(segment);
		}
	}

	return segments.join('/');
};

interface Params {
	/** Repo-relative path of the file the specifier is written in — its folder anchors the specifier. */
	from: string;
	/** The module specifier exactly as written. */
	specifier: string;
	/** Every file in scope — the universe a specifier resolves against. */
	files: Set<string>;
}

/**
 * The repo-relative file a relative specifier points at, or undefined when it
 * points at nothing in scope.
 *
 * Undefined is the honest answer for an external package, an asset the run
 * never listed, and a file outside the scope alike — every rule that resolves a
 * specifier treats all three the same way, by staying silent about it.
 * Extensions are probed in the order a bundler would: the file itself, then the
 * folder's barrel.
 *
 * @param from - the file the specifier is written in
 * @param specifier - the module specifier exactly as written
 * @param files - every file in scope
 */
export const resolveRelativeImport = ({ from, specifier, files }: Params): string | undefined => {
	if (!specifier.startsWith('.')) {
		return undefined;
	}

	const base = joinPath({ from: getDirectory({ path: from }), specifier });

	return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => files.has(candidate));
};
