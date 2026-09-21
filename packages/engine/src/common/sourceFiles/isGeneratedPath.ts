interface Params {
	/** One changed path, relative to the worktree. */
	path: string;
	/** The config's `generated` path prefixes, each a directory or a single file. */
	generated: string[];
}

/**
 * Whether one changed path falls under a configured generated entry.
 *
 * The trailing slash is stripped exactly as the source walk strips it, so a
 * directory prefix (`plugin/dist/`) and a single file
 * (`packages/web-app/src/routeTree.gen.ts`) both work without a second
 * spelling. The boundary is a path segment rather than the walk's bare
 * `startsWith`, deliberately: a walk that skips one extra file only misses a
 * check, while here a bare prefix would delete a source file named
 * `plugin/distortion.ts` before the commit.
 *
 * @returns true when the path is build output rather than source
 */
export const isGeneratedPath = ({ path, generated }: Params): boolean =>
	generated.some((entry) => {
		const prefix = entry.replace(/\/$/, '');

		return path === prefix || path.startsWith(`${prefix}/`);
	});
