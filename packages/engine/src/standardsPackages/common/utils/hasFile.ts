import { stat } from 'node:fs/promises';

interface Params {
	/** Absolute path of the file to look for. */
	path: string;
}

/**
 * Whether a path exists. Marker files are how the walk reads a package's tree —
 * a folder is a document because it holds document.md, a rule because it holds
 * rule.md, checked because it holds check.ts — so an unreadable path is an
 * answer of "no marker here", never an error to report.
 *
 * @param path - absolute path of the file to look for
 */
export const hasFile = async ({ path }: Params): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);
