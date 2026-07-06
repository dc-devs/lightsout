import { readFile, writeFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { frontmatterPattern } from './common/constants/frontmatterPattern';

interface Params {
	path: string;
	/** Mutates the raw (kebab-keyed) frontmatter object in place. */
	patch: (raw: Record<string, unknown>) => void;
}

/** Rewrite one connection doc's frontmatter in place, preserving its body — repairs are one-field edits, never regeneration. */
export const patchConnectionDoc = async ({ path, patch }: Params) => {
	const text = await readFile(path, 'utf8');
	const match = text.match(frontmatterPattern);

	if (!match?.[1]) {
		throw new Error(`${path} has no frontmatter to patch`);
	}

	const raw = parse(match[1]) as Record<string, unknown>;

	patch(raw);
	await writeFile(path, text.replace(frontmatterPattern, `---\n${stringify(raw).trimEnd()}\n---`), 'utf8');
};
