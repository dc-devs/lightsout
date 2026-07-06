import type { LightsoutConfig } from '@lightsout/contracts';
import { getDriver, type Driver } from '@lightsout/drivers';
import { loadConfig } from '@lightsout/engine';

interface Params {
	cwd: string;
}

/**
 * The optional-config + default-driver resolution shared by the map and plan
 * commands, which can run before a lightsout.config.json exists: the config
 * load is non-fatal and the driver falls back to claude-code. implement and
 * resume use the non-optional variant and are intentionally excluded.
 */
export const resolveConfigAndDriver = async ({ cwd }: Params): Promise<{ config: LightsoutConfig | undefined; driver: Driver }> => {
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const driver = getDriver({ name: config?.driver ?? 'claude-code' });

	return { config, driver };
};
