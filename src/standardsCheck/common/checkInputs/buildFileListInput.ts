import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { StandardsInputKind, type FileListInput } from '@/contracts';

interface Params {
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Monorepo package parent dir (config `packagesDir`, default 'packages'). */
	packagesDir: string;
}

const Manifest = z.object({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
	peerDependencies: z.record(z.string(), z.string()).optional(),
});

/**
 * Every dependency name one package declares, or undefined when the directory
 * ships no readable package.json at all — which is how a child of the packages
 * directory that is not a package drops out of the map entirely. A manifest
 * that exists but cannot be understood declares nothing, rather than making the
 * whole run fail over a file no check asked for.
 */
const getDependencyNames = async ({ manifestPath }: { manifestPath: string }) => {
	const text = await readFile(manifestPath, 'utf8').catch(() => undefined);

	if (text === undefined) {
		return undefined;
	}

	let data: unknown;

	try {
		data = JSON.parse(text);
	} catch {
		return [];
	}

	const parsed = Manifest.safeParse(data);

	if (!parsed.success) {
		return [];
	}

	return [parsed.data.dependencies, parsed.data.devDependencies, parsed.data.peerDependencies].flatMap((record) => Object.keys(record ?? {}));
};

/**
 * The path-only input, plus the one fact it carries that a path list cannot
 * show: what each package declares it depends on. The union is the same one
 * channel detection reads (dependencies, devDependencies, peerDependencies) —
 * a rule asking "does this repo use React?" is asking about declarations, not
 * about what happens to be installed.
 *
 * @param packagesDir - monorepo package parent dir; each child holding a package.json becomes an entry
 */
export const buildFileListInput = async ({ cwd, source, tests, files, referenceFiles, packagesDir }: Params): Promise<FileListInput> => {
	const dependencies = new Map<string, string[]>();

	dependencies.set('.', (await getDependencyNames({ manifestPath: join(cwd, 'package.json') })) ?? []);

	const children = await readdir(join(cwd, packagesDir)).catch(() => []);

	for (const name of children.sort()) {
		const names = await getDependencyNames({ manifestPath: join(cwd, packagesDir, name, 'package.json') });

		if (names !== undefined) {
			dependencies.set(`${packagesDir}/${name}`, names);
		}
	}

	return { kind: StandardsInputKind.FileList, cwd, source, tests, files, referenceFiles, dependencies };
};
