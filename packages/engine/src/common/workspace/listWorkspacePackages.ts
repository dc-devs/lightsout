import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { StandardsReader } from '#src/common/types/StandardsReader.ts';

interface Params {
	reader?: StandardsReader;
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
 * throwing for legacy callers. An observed reader instead preserves absence
 * and propagates unreadability so planning cannot infer an empty workspace.
 */
export const listWorkspacePackages = async ({ cwd, packagesDir, reader }: Params): Promise<string[]> => {
	const root = join(cwd, packagesDir);
	const entries = reader === undefined ? await readdir(root, { withFileTypes: true }).catch(() => []) : await reader.list({ path: root, optional: true });
	const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
	const hasManifest = await Promise.all(
		directories.map(({ name }) =>
			reader !== undefined
				? reader.exists({ path: join(root, name, 'package.json') })
				: stat(join(root, name, 'package.json'))
						.then(() => true)
						.catch(() => false),
		),
	);

	return directories.filter((_, index) => hasManifest[index]).map(({ name }) => name);
};
