import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Params {
	cwd: string;
	paths: string[];
}

/**
 * Load consumer standards files for inlining into agent invocations. A
 * declared-but-missing standards file is a hard error — running without
 * standards the consumer asked for would produce silently non-conformant
 * code, which is worse than not running.
 */
export const readStandards = async ({ cwd, paths }: Params) => {
	if (paths.length === 0) {
		return undefined;
	}

	const contents = await Promise.all(
		paths.map(async (path) => {
			const raw = await readFile(join(cwd, path), 'utf8').catch(() => {
				throw new Error(`standards file not found: ${join(cwd, path)}`);
			});

			return `<!-- ${path} -->\n${raw}`;
		}),
	);

	return contents.join('\n\n');
};
