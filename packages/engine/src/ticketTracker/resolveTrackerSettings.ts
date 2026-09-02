import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';

interface Params {
	config: LightsoutConfig;
	/** The process environment the API key is read from. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
}

/**
 * The `ticket-tracker` block with the API key read out of the environment, or
 * the one sentence saying why no tracker operation can run.
 *
 * It names the problem rather than answering undefined the way
 * `resolveShipSettings` does, because a missing block and a missing key are two
 * different things to fix and a user who hits one must not be told about the
 * other.
 *
 * There is no `provider` field on the result, for the reason `QueueSettings`
 * gives for having no `tracker` field: the key exists so a second adapter can be
 * named later, and while `linear` is the only literal it accepts there is
 * nothing for a resolved setting to vary on.
 */
export const resolveTrackerSettings = ({ config, env }: Params): TrackerSettings | TrackerFailure => {
	const block = config['ticket-tracker'];

	if (block === undefined) {
		return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming provider, team and api-key-env' };
	}

	const apiKeyEnv = block['api-key-env'];
	const apiKey = env[apiKeyEnv];

	if (apiKey === undefined || apiKey === '') {
		return { error: `the tracker API key is missing: set the \`${apiKeyEnv}\` environment variable` };
	}

	return { team: block.team, apiKey };
};
