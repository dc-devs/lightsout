import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';

interface Params {
	config: LightsoutConfig;
	/** The process environment the API key is read from. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
}

/**
 * The `queue` block with its defaults applied and the API key read out of the
 * environment, or the one sentence saying why the queue cannot start.
 *
 * It names the problem rather than answering undefined the way
 * `resolveShipSettings` does, because a missing block and a missing key are two
 * different things to fix and a user who hits one must not be told about the
 * other.
 *
 * The two status defaults are the one place the engine spells a status name,
 * and only as a fallback a repo overrides — the same shape as ship's default
 * ticket pattern.
 */
export const resolveQueueSettings = ({ config, env }: Params): QueueSettings | QueueFailure => {
	const queue = config.queue;

	if (queue === undefined) {
		return { error: '`lightsout queue` needs a `queue` block in lightsout.config.json naming tracker, team, route-labels, max-parallel and api-key-env' };
	}

	const apiKeyEnv = queue['api-key-env'];
	const apiKey = env[apiKeyEnv];

	if (apiKey === undefined || apiKey === '') {
		return { error: `the queue's tracker API key is missing: set the \`${apiKeyEnv}\` environment variable` };
	}

	return {
		team: queue.team,
		routeLabels: { direct: queue['route-labels'].direct, 'auto-plan': queue['route-labels']['auto-plan'] },
		maxParallel: queue['max-parallel'],
		apiKey,
		eligibleStatuses: queue['eligible-statuses'] ?? ['Backlog', 'Ready to implement'],
		inProgressStatus: queue['in-progress-status'] ?? 'In Progress',
		setup: queue.setup,
		branchTemplate: queue['branch-template'] ?? '{ticket}-{slug}',
		decisionsHeading: queue['decisions-heading'] ?? '## Decisions',
		workerMinutes: queue['worker-minutes'] ?? 240,
	};
};
