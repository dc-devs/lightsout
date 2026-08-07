import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LightsoutConfig } from '@/contracts';
import { getDriver, type Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { resolveCommandHarness } from '@/cli/common/utils/resolveCommandHarness';

interface Params {
	cwd: string;
	/** Which lightsout command is resolving — selects the config's per-command entry. */
	command: keyof NonNullable<LightsoutConfig['commands']>;
}

/**
 * The optional-config + per-command harness resolution shared by the plan and
 * improve commands, which can run before a lightsout.config.json exists: the
 * config load is non-fatal only when no config file exists, and the harness
 * falls back to claude-code. A config file that IS there but does not parse is a
 * hard error, exactly as it already is for implement, refactor, and resume. The
 * returned config is the EFFECTIVE config — its top-level
 * harness/model/effort are overwritten with this command's resolved values, so
 * downstream reads of `config.model` are already per-command.
 */
export const resolveConfigAndDriver = async ({ cwd, command }: Params): Promise<{ config: LightsoutConfig | undefined; driver: Driver }> => {
	const configPath = join(cwd, 'lightsout.config.json');
	const present = await stat(configPath).then(
		() => true,
		() => false,
	);
	// A missing config is fine — plan and improve are the two commands that can run
	// before one exists. A config that IS there and does not parse is a mistake worth
	// stopping for: continuing would silently discard every setting in it, including
	// the removed keys' replacements.
	const loaded = present ? await loadConfig({ cwd }) : undefined;
	const { driverName, model, effort } = resolveCommandHarness({ config: loaded, command });
	const driver = getDriver({ name: driverName });
	const config = loaded ? { ...loaded, harness: driverName, model, effort } : undefined;

	return { config, driver };
};
