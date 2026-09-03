import { readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

// The walk never reads above the scope, so a manifest belonging to some other
// package can never decide this file's module system.
const withinScope = ({ directory, scopeRoot }: { directory: string; scopeRoot: string }) => {
	const path = relative(scopeRoot, directory);

	return path === '' || !(path === '..' || path.startsWith(`..${sep}`));
};

// `readPackageManifest` is not the reader for this: it throws on a manifest
// with no `name`, which is right when the engine needs a workspace filter and
// wrong here, where an unreadable manifest simply means "not `type: module`".
const readManifestType = async ({ manifestPath }: { manifestPath: string }) => {
	try {
		const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
		const declared = typeof parsed === 'object' && parsed !== null && 'type' in parsed ? parsed.type : undefined;

		return typeof declared === 'string' ? declared : undefined;
	} catch {
		return undefined;
	}
};

interface Params {
	/** Absolute directory holding the file being classified. */
	fileDir: string;
	/** Absolute scope root — the walk stops here, and never reads above it. */
	scopeRoot: string;
}

/**
 * The `"type"` of the package.json that governs one file, or undefined when no
 * manifest between the file and its scope root declares one.
 *
 * The *nearest* manifest is what Node and Jest both read, and the distinction
 * is load-bearing: a nested package that sets no `type` is CommonJS even inside
 * a repo whose root manifest says `"type": "module"`. Reading only the scope
 * root would call that nested `.js` file an ES module and hold it to a bar no
 * test could clear.
 */
export const readNearestPackageType = async ({ fileDir, scopeRoot }: Params): Promise<string | undefined> => {
	let directory = fileDir;
	let type: string | undefined;

	while (type === undefined && withinScope({ directory, scopeRoot })) {
		type = await readManifestType({ manifestPath: join(directory, 'package.json') });

		const parent = dirname(directory);

		if (parent === directory) {
			break;
		}

		directory = parent;
	}

	return type;
};
