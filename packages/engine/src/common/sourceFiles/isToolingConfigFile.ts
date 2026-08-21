interface Params {
	/** Repo-relative path — both the folder it sits in and its name decide the answer. */
	path: string;
	/** The workspace's packages folder, so a package root is recognised as a root. */
	packagesDir: string;
}

/**
 * True for a tool's own settings file — `jest.config.cjs`, `vite.config.ts`
 * and the like, sitting at the repo root or a package root.
 *
 * The tool that owns the file reads it directly; nothing under test ever
 * imports it, and no coverage report can list it. Demanding that a test run it
 * reports a fault no test could fix, and sending it to a test writer wastes the
 * writer.
 *
 * Location is half the rule. A settings file lives at a root, never inside a
 * source tree, so `src/feature.config.ts` is ordinary code that keeps its test
 * and its place in the coverage numbers.
 */
export const isToolingConfigFile = ({ path, packagesDir }: Params): boolean => {
	const segments = path.split('/');
	const name = segments.at(-1) ?? '';
	const folder = segments.slice(0, -1);

	if (!/\.config\.(c|m)?[jt]s$/i.test(name)) {
		return false;
	}

	// A root is the repo itself (no folder) or one package folder inside the
	// packages dir — anything deeper is a source tree.
	return folder.length === 0 || (folder.length === 2 && folder[0] === packagesDir);
};
