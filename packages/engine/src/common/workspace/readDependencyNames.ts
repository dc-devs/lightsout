import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { StandardsReader } from '#src/common/types/StandardsReader.ts';

const Manifest = z.object({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
	peerDependencies: z.record(z.string(), z.string()).optional(),
});

interface Params {
	reader?: StandardsReader;
	required?: boolean;
	manifestPath: string;
}

/**
 * Every dependency name one package declares, or undefined when the directory
 * ships no readable package.json at all — which is how a child of the packages
 * directory that is not a package drops out of a caller's map entirely. A
 * manifest that exists but cannot be understood declares nothing, rather than
 * making the whole run fail over a file no caller asked for. An observed reader
 * opts into strict acquisition: malformed input and required missing manifests
 * throw before a planner can silently omit applicable framework standards.
 *
 * The union is deliberate (dependencies, devDependencies, peerDependencies): a
 * question like "does this repo use React?" is about what a package declares,
 * not about what happens to be installed.
 */
export const readDependencyNames = async ({ manifestPath, reader, required = false }: Params): Promise<string[] | undefined> => {
	const text = reader === undefined ? await readFile(manifestPath, 'utf8').catch(() => undefined) : await reader.text({ path: manifestPath });

	if (text === undefined) {
		if (reader !== undefined && required) throw new Error(`Required standards dependency manifest is missing: ${manifestPath}`);
		return undefined;
	}

	let data: unknown;

	try {
		data = JSON.parse(text);
	} catch (error) {
		if (reader !== undefined) throw new Error(`Invalid standards dependency manifest: ${manifestPath}`, { cause: error });
		return [];
	}

	const parsed = Manifest.safeParse(data);

	if (!parsed.success) {
		if (reader !== undefined) throw new Error(`Invalid standards dependency manifest: ${manifestPath}`, { cause: parsed.error });
		return [];
	}

	return [parsed.data.dependencies, parsed.data.devDependencies, parsed.data.peerDependencies].flatMap((record) => Object.keys(record ?? {}));
};
