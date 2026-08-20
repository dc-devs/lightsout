import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

interface Params {
	/** Extra top-level config fields merged beside `gates` (commands, standards-checks, ...). */
	config?: Record<string, unknown>;
}

/**
 * A consumer repo with the gate config every mutating command demands, and
 * nothing else — enough for `refactor` to get past loadConfig and reach its own
 * argument checks.
 */
export const seedConfiguredCwd = async ({ config }: Params = {}): Promise<string> => {
	const cwd = await freshCwd();

	await writeFile(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false }, ...config }), 'utf8');

	return cwd;
};
