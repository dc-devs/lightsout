import { resolveCommandHarness } from '#src/cli/common/utils/resolveCommandHarness.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { type Driver, getDriver } from '#src/drivers/index.ts';

interface Params {
	/** The config as it was read from disk, before this command's harness entry is applied. */
	config: LightsoutConfig;
	/** Which lightsout command is resolving — selects the config's per-command entry. */
	command: keyof NonNullable<LightsoutConfig['commands']>;
}

/**
 * Pick one command's harness and hand back everything that follows from it.
 *
 * The returned config is the EFFECTIVE config — its top-level harness, model
 * and effort are overwritten with this command's resolved values, so every
 * downstream read of `config.model` is already per-command. Stating that once
 * is the point: a command that spelled the overwrite itself could quietly leave
 * a field out, and nothing downstream would notice.
 *
 * The sibling `resolveConfigAndDriver` is for the commands that may run before
 * a lightsout.config.json exists at all; this one is for the commands that
 * already required one.
 */
export const resolveEffectiveConfigAndDriver = ({ config, command }: Params): { config: LightsoutConfig; driver: Driver; driverName: string } => {
	const { driverName, model, effort } = resolveCommandHarness({ config, command });

	return { config: { ...config, harness: driverName, model, effort }, driver: getDriver({ name: driverName }), driverName };
};
