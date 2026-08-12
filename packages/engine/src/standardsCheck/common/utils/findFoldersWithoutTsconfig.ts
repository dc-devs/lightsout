interface Params {
	/** Repo-relative paths of the files the run judged. */
	files: string[];
	/** The run's file text, which carries every tsconfig.json the run found. */
	contents: Map<string, string>;
}

/**
 * The folders holding judged files that no tsconfig sits above.
 *
 * A rule resolving an import needs the path aliases of the package holding the
 * file, and a package with no tsconfig has none to give. Those rules then
 * cannot tell an alias from a published package, so they stay silent rather
 * than guess — correct, and invisible. This is what makes it visible: the run
 * names the folders it could not answer for, so a clean report is never
 * mistaken for a question nobody asked.
 *
 * Folders rather than files, because the answer is identical for every file in
 * one and a list of six hundred paths is not a note anybody reads.
 */
export const findFoldersWithoutTsconfig = ({ files, contents }: Params): string[] => {
	const answered = new Map<string, boolean>();

	const parentOf = (folder: string) => {
		const cut = folder.lastIndexOf('/');

		return cut === -1 ? '.' : folder.slice(0, cut);
	};

	const hasTsconfig = (folder: string): boolean => {
		const cached = answered.get(folder);

		if (cached !== undefined) {
			return cached;
		}

		const found = contents.has(folder === '.' ? 'tsconfig.json' : `${folder}/tsconfig.json`) || (folder !== '.' && hasTsconfig(parentOf(folder)));

		answered.set(folder, found);

		return found;
	};

	const uncovered = new Set<string>();

	for (const file of files) {
		const folder = parentOf(file);

		if (!hasTsconfig(folder)) {
			uncovered.add(folder);
		}
	}

	return [...uncovered].sort();
};
