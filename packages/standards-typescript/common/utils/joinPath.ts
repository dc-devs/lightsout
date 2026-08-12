interface Params {
	/** Repo-relative folder the specifier is anchored to, or `.` for the repo root. */
	from: string;
	/** The path to follow from there — `./x`, `../x` and bare `x` all read the same way. */
	specifier: string;
}

/**
 * `src/feature` + `./thing` flattened to `src/feature/thing`, with `..`
 * segments walked and `.` segments dropped.
 *
 * String work rather than `node:path` for the reason every path helper here is:
 * a check imports only from inside its own package, and the paths it is handed
 * are repo-relative and `/`-separated on every machine.
 */
export const joinPath = ({ from, specifier }: Params): string => {
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
