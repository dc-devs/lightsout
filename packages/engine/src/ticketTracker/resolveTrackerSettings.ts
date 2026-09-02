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
 * Provider-specific values remain inside this seam. Queue behavior is resolved
 * elsewhere and cannot leak into these settings.
 */
export const resolveTrackerSettings = ({ config, env }: Params): TrackerSettings | TrackerFailure => {
	const block = config['ticket-tracker'];

	if (block === undefined) {
		return { error: 'this command needs a `ticket-tracker` block in lightsout.config.json naming a provider and its credentials' };
	}

	const apiKeyEnv = block['api-key-env'];
	const apiKey = env[apiKeyEnv];

	if (apiKey === undefined || apiKey === '') {
		return { error: `the tracker API key is missing: set the \`${apiKeyEnv}\` environment variable` };
	}

	if (block.provider === 'linear') {
		return { provider: 'linear', ticketPrefix: block.team, team: block.team, apiKey };
	}

	const apiUserEmailEnv = block['api-user-email-env'];
	const apiUserEmail = env[apiUserEmailEnv];

	if (apiUserEmail === undefined || apiUserEmail === '') {
		return { error: `the Jira API user email is missing: set the \`${apiUserEmailEnv}\` environment variable` };
	}

	return {
		provider: 'jira',
		ticketPrefix: block.project,
		siteUrl: block['site-url'].replace(/\/$/u, ''),
		project: block.project,
		apiKey,
		apiUserEmail,
	};
};
