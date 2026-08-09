import { getDirectory } from './getDirectory.ts';

interface Params {
	/** Repo-relative file paths. */
	files: string[];
}

/**
 * Every directory holding one of these files, plus each of its ancestors, as
 * repo-relative paths.
 *
 * A file list never names the empty folders between its entries, so a rule that
 * judges folders — one that objects to a folder's name or its place — has to
 * derive them. The repo root (`.`) is never a member: those rules judge named
 * folders and would have to filter it back out.
 */
export const collectDirectories = ({ files }: Params): Set<string> => {
	const directories = new Set<string>();

	for (const file of files) {
		let directory = getDirectory({ path: file });

		while (directory !== '.' && !directories.has(directory)) {
			directories.add(directory);
			directory = getDirectory({ path: directory });
		}
	}

	return directories;
};
