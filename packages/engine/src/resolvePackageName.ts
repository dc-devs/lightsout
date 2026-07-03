import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const PackageManifest = z.object({ name: z.string().min(1) });

interface Params {
	cwd: string;
	packagesDir: string;
	/** Package directory name (e.g. 'backend-api' under packages/). */
	packageDir: string;
}

/**
 * Resolve a package directory to its package.json `name` — the value a
 * workspace filter (`pnpm --filter <name>`) actually wants, which may differ
 * from the directory (e.g. `@feedbackdrop/backend-api`). A missing or
 * nameless package.json is a hard error: the engine never guesses a filter.
 */
export const resolvePackageName = async ({ cwd, packagesDir, packageDir }: Params) => {
	const manifestPath = join(cwd, packagesDir, packageDir, 'package.json');
	const raw = await readFile(manifestPath, 'utf8').catch(() => {
		throw new Error(`declared package '${packageDir}' has no package.json at ${manifestPath}`);
	});
	const parsed = PackageManifest.safeParse(JSON.parse(raw));

	if (!parsed.success) {
		throw new Error(`package.json at ${manifestPath} has no "name" — required for {package} substitution`);
	}

	return parsed.data.name;
};
