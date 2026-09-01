import type { LightsoutConfig } from '#src/contracts/index.ts';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { parseDurationMs } from '#src/queue/common/utils/parseDurationMs.ts';

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
		return {
			error: '`lightsout queue` needs a `queue` block in lightsout.config.json naming a tracker connection, route-labels, max-parallel and api-key-env',
		};
	}

	const apiKeyEnv = queue['api-key-env'];
	const apiKey = env[apiKeyEnv];

	if (apiKey === undefined || apiKey === '') {
		return { error: `the queue's tracker API key is missing: set the \`${apiKeyEnv}\` environment variable` };
	}

	const workerTimeoutMs = parseDurationMs({ value: queue['worker-timeout'] ?? '4h', key: 'queue.worker-timeout' });

	if (typeof workerTimeoutMs !== 'number') {
		return workerTimeoutMs;
	}

	const questionTimeoutMs = parseDurationMs({ value: queue['question-timeout'] ?? '1h', key: 'queue.question-timeout' });

	if (typeof questionTimeoutMs !== 'number') {
		return questionTimeoutMs;
	}

	const shared = {
		routeLabels: { [QueueRoute.Direct]: queue['route-labels'].direct, [QueueRoute.AutoPlan]: queue['route-labels']['auto-plan'] },
		maxParallel: queue['max-parallel'],
		apiKey,
		eligibleStatuses: queue['eligible-statuses'] ?? ['Backlog', 'Ready to implement'],
		inProgressStatus: queue['in-progress-status'] ?? 'In Progress',
		setup: queue.setup,
		branchTemplate: queue['branch-template'] ?? '{ticket}-{slug}',
		decisionsHeading: queue['decisions-heading'] ?? '## Decisions',
		workerTimeoutMs,
		questionTimeoutMs,
		parkedLabel: queue['parked-label'],
	};

	if (queue.tracker === 'linear') {
		return { tracker: 'linear', ticketPrefix: queue.team, team: queue.team, ...shared };
	}

	const apiUserEmailEnv = queue['api-user-email-env'];
	const apiUserEmail = env[apiUserEmailEnv];

	if (apiUserEmail === undefined || apiUserEmail === '') {
		return { error: `the queue's Jira account email is missing: set the \`${apiUserEmailEnv}\` environment variable` };
	}

	return {
		tracker: 'jira',
		ticketPrefix: queue.project,
		siteUrl: queue['site-url'].replace(/\/$/, ''),
		project: queue.project,
		apiUserEmail,
		...shared,
	};
};
