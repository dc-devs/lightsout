import { z } from 'zod';

/** Only the script names are read here, so the values are left unconstrained — a manifest is not this engine's schema to police. */
const Manifest = z.object({ scripts: z.record(z.string(), z.unknown()).optional() });

interface Params {
	/** Raw package.json text, trusted to be neither valid JSON nor a manifest. */
	raw: string;
}

/**
 * The script names a package.json declares, empty when the text will not parse
 * or declares none. Both plan checks that ask "does this script exist?" read
 * manifests through here, so the two can never answer the question differently.
 * Never throws — an unreadable manifest contributes no scripts.
 */
export const getManifestScriptKeys = ({ raw }: Params): Set<string> => {
	try {
		const parsed = Manifest.safeParse(JSON.parse(raw));

		return new Set(parsed.success ? Object.keys(parsed.data.scripts ?? {}) : []);
	} catch {
		return new Set();
	}
};
