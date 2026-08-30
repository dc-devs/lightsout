import { contradictoryShipFlagsMessage } from '#src/cli/common/constants/contradictoryShipFlagsMessage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { resolveShipIntent, type ShipIntent } from '#src/ship/index.ts';

interface Params {
	config: LightsoutConfig;
	flags: CommandContext['flags'];
	/** The process environment, read for the queue's own suppression variable. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
}

/**
 * The ship intent both implement paths settle before their run starts, with the
 * contradictory-flags refusal already reported.
 *
 * Resolving it here rather than at the run's exit is what lets the manifest
 * record what the run is going to do, so the progress view can draw a ship row.
 * `exitAfterImplement` re-resolves the same inputs at the end and agrees by
 * construction.
 *
 * @returns The intent, or undefined when `--ship` and `--no-ship` were both
 * typed — the message is already on stderr and the caller exits 1 without
 * starting any work.
 */
export const resolveCommandShipIntent = ({ config, flags, env }: Params): ShipIntent | undefined => {
	const intent = resolveShipIntent({
		config,
		shipFlag: flags.get('ship') === true,
		noShipFlag: flags.get('no-ship') === true,
		env,
	});

	if (intent.contradictory) {
		console.error(contradictoryShipFlagsMessage);

		return undefined;
	}

	return intent;
};
