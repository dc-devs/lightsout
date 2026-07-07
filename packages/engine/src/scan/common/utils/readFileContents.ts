import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Params {
	cwd: string;
	/** Repo-relative paths; deduped before reading, unreadable files map to ''. */
	files: string[];
}

/**
 * Read a set of files into a path → text map, deduped, with unreadable files
 * mapped to an empty string. Shared by the text-based scan detectors, which
 * load their file universe up front before pattern-matching.
 */
export const readFileContents = async ({ cwd, files }: Params): Promise<Map<string, string>> => {
	const contents = new Map<string, string>();

	for (const file of new Set(files)) {
		contents.set(file, (await readFile(join(cwd, file), 'utf8').catch(() => '')) ?? '');
	}

	return contents;
};
