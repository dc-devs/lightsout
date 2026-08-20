import { getDirectory } from './getDirectory.ts';
import { isRecord } from './isRecord.ts';

/** Every name one manifest declares across the three dependency fields, or undefined when the text is not a manifest. */
const readNames = ({ text }: { text: string }) => {
	let data: unknown;

	try {
		data = JSON.parse(text);
	} catch {
		return undefined;
	}

	const manifest = isRecord(data) ? data : undefined;

	if (manifest === undefined) {
		return undefined;
	}

	return ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((field) => {
		const declared = manifest[field];

		return isRecord(declared) ? Object.keys(declared) : [];
	});
};

interface Params {
	/** The run's file text, which carries every package.json above a judged file. */
	contents: Map<string, string>;
}

/**
 * What each package in scope declares it depends on, keyed by the package's
 * directory — the shape `getFrameworkCarveOuts` reads.
 *
 * The file-list input carries this map ready-made; a file-text input does not,
 * but it does carry the manifests themselves, so a rule that judges text and
 * still needs to know which framework governs a file can ask here rather than
 * declare a second input kind it has no other use for.
 *
 * The union of the three dependency fields is deliberate, and matches how the
 * engine builds the same map: "does this package use TanStack Router?" is a
 * question about what a package declares, not about which field it declared it
 * in.
 */
export const readManifestDependencies = ({ contents }: Params): Map<string, string[]> => {
	const dependencies = new Map<string, string[]>();

	for (const [path, text] of contents) {
		if (path !== 'package.json' && !path.endsWith('/package.json')) {
			continue;
		}

		const names = readNames({ text });

		if (names !== undefined) {
			dependencies.set(getDirectory({ path }), names);
		}
	}

	return dependencies;
};
