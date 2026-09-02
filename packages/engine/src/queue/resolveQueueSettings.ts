import type { LightsoutConfig } from '#src/contracts/index.ts';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { parseDurationMs } from '#src/queue/common/utils/parseDurationMs.ts';

interface Params {
	config: LightsoutConfig;
	/**
	 * The process environment. Nothing in this block reads it any more — the API
	 * key moved to `resolveTrackerSettings` — but it stays on the signature
	 * beside it, so the two resolvers a command calls together are called the
	 * same way.
	 */
	env: NodeJS.ProcessEnv;
}

/**
 * The `queue` block with its defaults applied, or the one sentence saying why
 * the queue cannot start.
 *
 * It answers only for the `queue` block. Tracker identity is
 * `resolveTrackerSettings`'s to resolve and its missing key is that function's
 * to name, and the two failures still reach the user separately because
 * `queueCommand` calls both — a missing block and a missing key are different
 * things to fix, and a user who hits one must not be told about the other.
 *
 * The two status defaults are the one place the engine spells a status name,
 * and only as a fallback a repo overrides — the same shape as ship's default
 * ticket pattern.
 */
export const resolveQueueSettings = ({ config }: Params): QueueSettings | QueueFailure => {
	const queue = config.queue;

	if (queue === undefined) {
		return { error: '`lightsout queue` needs a `queue` block in lightsout.config.json naming route-labels and max-parallel' };
	}

	const workerTimeoutMs = parseDurationMs({ value: queue['worker-timeout'] ?? '4h', key: 'queue.worker-timeout' });

	if (typeof workerTimeoutMs !== 'number') {
		return workerTimeoutMs;
	}

	const questionTimeoutMs = parseDurationMs({ value: queue['question-timeout'] ?? '1h', key: 'queue.question-timeout' });

	if (typeof questionTimeoutMs !== 'number') {
		return questionTimeoutMs;
	}

	return {
		routeLabels: { [QueueRoute.Direct]: queue['route-labels'].direct, [QueueRoute.AutoPlan]: queue['route-labels']['auto-plan'] },
		maxParallel: queue['max-parallel'],
		eligibleStatuses: queue['eligible-statuses'] ?? ['Backlog', 'Ready to implement'],
		inProgressStatus: queue['in-progress-status'] ?? 'In Progress',
		setup: queue.setup,
		branchTemplate: queue['branch-template'] ?? '{ticket}-{slug}',
		decisionsHeading: queue['decisions-heading'] ?? '## Decisions',
		workerTimeoutMs,
		questionTimeoutMs,
		parkedLabel: queue['parked-label'],
	};
};
