import { join } from 'node:path';
import { parseConfig } from '#src/common/config/parseConfig.ts';
import { readConfigFile } from '#src/common/config/readConfigFile.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
}

/**
 * Read and validate `lightsout.config.json` from the target repo root — the
 * single coupling point between engine and consumer. A missing or invalid
 * config is a hard error before any run is created.
 *
 * `readOptionalConfig` is the same read for the commands that may run without
 * one; it differs only in treating absence as an answer rather than an error.
 */
export const readConfig = async ({ cwd }: Params): Promise<LightsoutConfig> => {
	const configPath = join(cwd, 'lightsout.config.json');
	const raw = await readConfigFile({ configPath });

	if (raw === undefined) {
		throw new Error(`lightsout.config.json not found at ${configPath}`);
	}

	return parseConfig({ raw, configPath });
};
