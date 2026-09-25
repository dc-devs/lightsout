import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

interface Params {
	/** Absolute path of one package directory. */
	packageDir: string;
}

/**
 * Jest config files for one package dir: root-level jest.config.* plus anything
 * jest-named under test/ or tests/ (bounded — never node_modules). Both
 * spellings are scanned because `isTestFile` already accepts both, and a repo
 * using the plural would otherwise sit in a blind spot.
 *
 * Shared rather than private to one check, because two doctor checks now ask
 * different questions of the same set of files and must not disagree about
 * which files those are.
 */
export const findJestConfigs = async ({ packageDir }: Params): Promise<string[]> => {
	const rootEntries: string[] = await readdir(packageDir).catch(() => []);
	const found = rootEntries.filter((name) => /^jest(\..+)?\.config\.(js|cjs|mjs|ts)$/.test(name)).map((name) => join(packageDir, name));

	for (const testDir of ['test', 'tests']) {
		const testEntries: string[] = await readdir(join(packageDir, testDir), { recursive: true }).catch(() => []);

		found.push(
			...testEntries
				.filter((name) => typeof name === 'string' && /(^|\/)jest[^/]*\.config\.(js|cjs|mjs|ts)$/.test(name))
				.map((name) => join(packageDir, testDir, name)),
		);
	}

	return found;
};
