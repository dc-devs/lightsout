import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultCodeStandards } from './defaultCodeStandards';
import { defaultTestStandards } from './defaultTestStandards';

/** Reserved entries that resolve to the engine's bundled default docs instead of files. */
const tokens: Record<string, string> = {
	'lightsout:code-defaults': defaultCodeStandards,
	'lightsout:test-defaults': defaultTestStandards,
};

interface Params {
	cwd: string;
	paths: string[];
}

/**
 * Load standards for inlining into agent invocations. Each entry is either a
 * reserved token (`lightsout:code-defaults` / `lightsout:test-defaults` — the
 * docs bundled from this repo's standards/ folders) or a repo-relative
 * markdown file. A declared-but-missing file is a hard error — running
 * without standards the consumer asked for would produce silently
 * non-conformant code, which is worse than not running.
 */
export const readStandards = async ({ cwd, paths }: Params) => {
	if (paths.length === 0) {
		return undefined;
	}

	const contents = await Promise.all(
		paths.map(async (path) => {
			const bundled = tokens[path];

			if (bundled) {
				return bundled;
			}

			const raw = await readFile(join(cwd, path), 'utf8').catch(() => {
				throw new Error(`standards file not found: ${join(cwd, path)}`);
			});

			return `<!-- ${path} -->\n${raw}`;
		}),
	);

	return contents.join('\n\n');
};
