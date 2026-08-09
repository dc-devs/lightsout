interface Params {
	/** A repo-relative path, always `/`-separated as every input the engine builds is. */
	path: string;
}

/**
 * The folder a path sits in, or `.` when it sits at the repo root.
 *
 * Written as string work rather than borrowed from `node:path` because a check
 * imports values from inside its own package alone — and because the paths it
 * is handed are repo-relative and `/`-separated whatever the machine, so the
 * platform-aware version would answer the same question with more machinery.
 */
export const getDirectory = ({ path }: Params): string => {
	const cut = path.lastIndexOf('/');

	return cut === -1 ? '.' : path.slice(0, cut);
};
