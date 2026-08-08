import { dirname } from 'node:path';

interface Params {
	/** Repo-relative file paths. */
	files: string[];
}

/**
 * Every directory holding one of these files, plus each of its ancestors, as
 * repo-relative paths.
 *
 * The repo root (`.`) is never a member: the folder rules judge named folders
 * and would have to filter it back out, so the one caller that does want it —
 * the carve-out reader, since a non-monorepo's manifest sits there — prepends
 * it itself.
 */
export const collectDirectories = ({ files }: Params): Set<string> => {
	const directories = new Set<string>();

	for (const file of files) {
		let directory = dirname(file);

		while (directory !== '.' && !directories.has(directory)) {
			directories.add(directory);
			directory = dirname(directory);
		}
	}

	return directories;
};
