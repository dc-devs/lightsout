import type { LightsoutConfig } from '@lightsout/contracts';
import { getDriver, type Driver } from '@lightsout/drivers';
import { loadConfig } from '@lightsout/engine';
import { resolveCommandHarness } from './resolveCommandHarness';

interface Params {
	cwd: string;
	/** Which lightsout command is resolving — selects the config's per-command entry. */
	command: keyof NonNullable<LightsoutConfig['commands']>;
}

/**
 * The optional-config + per-command driver resolution shared by the plan and
 * improve commands, which can run before a lightsout.config.json exists: the
 * config load is non-fatal and the driver falls back to claude-code. The
 * returned config is the EFFECTIVE config — its top-level driver/model are
 * overwritten with this command's resolved values, so downstream reads of
 * `config.model` are already per-command. implement, refactor, and resume use
 * the non-optional loadConfig and are intentionally excluded.
 */
export const resolveConfigAndDriver = async ({ cwd, command }: Params): Promise<{ config: LightsoutConfig | undefined; driver: Driver }> => {
	const loaded = await loadConfig({ cwd }).catch(() => undefined);
	const { driverName, model } = resolveCommandHarness({ config: loaded, command });
	const driver = getDriver({ name: driverName });
	const config = loaded ? { ...loaded, driver: driverName, model } : undefined;

	return { config, driver };
};
