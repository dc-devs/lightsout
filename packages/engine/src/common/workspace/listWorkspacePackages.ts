import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

interface Params {
	cwd: string;
	/** Monorepo package parent dir (e.g. 'packages'). */
	packagesDir: string;
}

/**
 * The directory names under the packages dir that hold a `package.json`.
 *
 * This answers "does this package exist", which is a different question from
 * `readPackageManifest`'s "what is this package called and what scripts does it
 * define" — which is why it never reads or parses the file. A package whose
 * manifest is malformed still exists, so calling it absent here would be a lie,
 * and it would steal the precise error `readPackageManifest` already gives.
 *
 * A missing or unreadable packages dir yields an empty list rather than
 * throwing: callers read that as "nothing is known about this workspace".
 */
export const listWorkspacePackages = async ({ cwd, packagesDir }: Params): Promise<string[]> => {
	const root = join(cwd, packagesDir);
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
	const hasManifest = await Promise.all(
		directories.map(({ name }) =>
			stat(join(root, name, 'package.json'))
				.then(() => true)
				.catch(() => false),
		),
	);

	return directories.filter((_, index) => hasManifest[index]).map(({ name }) => name);
};
