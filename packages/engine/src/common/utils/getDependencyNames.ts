import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const Manifest = z.object({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
	peerDependencies: z.record(z.string(), z.string()).optional(),
});

interface Params {
	manifestPath: string;
}

/**
 * Every dependency name one package declares, or undefined when the directory
 * ships no readable package.json at all — which is how a child of the packages
 * directory that is not a package drops out of a caller's map entirely. A
 * manifest that exists but cannot be understood declares nothing, rather than
 * making the whole run fail over a file no caller asked for.
 *
 * The union is deliberate (dependencies, devDependencies, peerDependencies): a
 * question like "does this repo use React?" is about what a package declares,
 * not about what happens to be installed.
 */
export const getDependencyNames = async ({ manifestPath }: Params): Promise<string[] | undefined> => {
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
