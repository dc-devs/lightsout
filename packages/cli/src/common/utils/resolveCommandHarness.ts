import type { Effort, LightsoutConfig } from '@lightsout/contracts';

interface Params {
	config: LightsoutConfig | undefined;
	/** Which lightsout command is resolving — selects the config's per-command entry. */
	command: keyof NonNullable<LightsoutConfig['commands']>;
}

/**
 * Per-command harness resolution: the command's `commands` entry wins, the
 * global `harness`/`model`/`effort` are the fallback, `claude-code` is the final
 * harness default. The global `model` falls through only when the command
 * resolves to the global harness — a model name is meaningful only to its own
 * harness, so a per-command harness override never inherits the other harness's
 * model. The global `effort` always falls through, because the five levels mean
 * the same thing on every harness.
 */
export const resolveCommandHarness = ({ config, command }: Params): { driverName: string; model: string | undefined; effort: Effort | undefined } => {
	const entry = config?.commands?.[command];
	const globalHarnessName = config?.harness ?? 'claude-code';
	const driverName = entry?.harness ?? globalHarnessName;
	const model = entry?.model ?? (driverName === globalHarnessName ? config?.model : undefined);
	const effort = entry?.effort ?? config?.effort;

	return { driverName, model, effort };
};
