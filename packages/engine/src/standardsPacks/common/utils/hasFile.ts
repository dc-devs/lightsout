import { stat } from 'node:fs/promises';
import type { StandardsReader } from '#src/common/types/StandardsReader.ts';

interface Params {
	reader?: StandardsReader;
	/** Absolute path of the file to look for. */
	path: string;
}

/**
 * Whether a path exists. Marker files are how the walk reads a pack's tree —
 * a folder is a document because it holds document.md, a rule because it holds
 * rule.md, checked because it holds check.ts — so an unreadable path is an
 * answer of "no marker here", never an error to report.
 *
 * @param path - absolute path of the file to look for
 */
export const hasFile = async ({ path, reader }: Params): Promise<boolean> =>
	reader !== undefined
		? reader.exists({ path })
		: stat(path).then(
				() => true,
				() => false,
			);
