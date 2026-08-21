import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
}

/**
 * Read and validate `lightsout.config.json` from the target repo root — the
 * single coupling point between engine and consumer. A missing or invalid
 * config is a hard error before any run is created.
 */
export const readConfig = async ({ cwd }: Params): Promise<LightsoutConfig> => {
	const configPath = join(cwd, 'lightsout.config.json');
	const raw = await readFile(configPath, 'utf8').catch(() => {
		throw new Error(`lightsout.config.json not found at ${configPath}`);
	});

	return LightsoutConfig.parse(JSON.parse(raw));
};
