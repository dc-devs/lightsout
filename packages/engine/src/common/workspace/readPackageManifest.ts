import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const PackageManifest = z.object({
	name: z.string().min(1),
	scripts: z.record(z.string(), z.string()).optional(),
});

interface Params {
	cwd: string;
	packagesDir: string;
	/** Package directory name (e.g. 'backend-api' under packages/). */
	packageDir: string;
}

/**
 * Read a package directory's package.json `name` — the value a
 * workspace filter (`pnpm --filter <name>`) actually wants, which may differ
 * from the directory (e.g. `@feedbackdrop/backend-api`) — and its `scripts`
 * map, which scoped gates consult to skip gates the package doesn't define.
 * A missing or nameless package.json is a hard error: the engine never
 * guesses a filter.
 */
export const readPackageManifest = async ({ cwd, packagesDir, packageDir }: Params): Promise<{ name: string; scripts: Record<string, string> }> => {
	const manifestPath = join(cwd, packagesDir, packageDir, 'package.json');
	const raw = await readFile(manifestPath, 'utf8').catch(() => {
		throw new Error(`declared package '${packageDir}' has no package.json at ${manifestPath}`);
	});
	const parsed = PackageManifest.safeParse(JSON.parse(raw));

	if (!parsed.success) {
		throw new Error(`package.json at ${manifestPath} has no "name" — required for {package} substitution`);
	}

	return { name: parsed.data.name, scripts: parsed.data.scripts ?? {} };
};
