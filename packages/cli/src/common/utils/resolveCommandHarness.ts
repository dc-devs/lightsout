import type { LightsoutConfig } from '@lightsout/contracts';

interface Params {
	config: LightsoutConfig | undefined;
	/** Which lightsout command is resolving — selects the config's per-command entry. */
	command: keyof NonNullable<LightsoutConfig['commands']>;
}

/**
 * Per-command harness resolution: the command's `commands` entry wins, the
 * global `driver`/`model` are the fallback, `claude-code` is the final driver
 * default. The global `model` falls through only when the command resolves to
 * the global driver — a model name is meaningful only to its own harness, so a
 * per-command driver override never inherits the other harness's model.
 */
export const resolveCommandHarness = ({ config, command }: Params): { driverName: string; model: string | undefined } => {
	const entry = config?.commands?.[command];
	const globalDriverName = config?.driver ?? 'claude-code';
	const driverName = entry?.driver ?? globalDriverName;
	const model = entry?.model ?? (driverName === globalDriverName ? config?.model : undefined);

	return { driverName, model };
};
