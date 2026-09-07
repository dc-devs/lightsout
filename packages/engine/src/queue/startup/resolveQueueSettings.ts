import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { parseDurationMs } from '#src/queue/common/utils/parseDurationMs.ts';
import { resolveLifecycleSettings } from '#src/ticketLifecycle/index.ts';

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
 * The four status names and the five planning-status labels resolve in the
 * lifecycle module, because the command edge writes both fields without a
 * queue; `resolveLifecycleSettings` is the one place the engine spells a status
 * name, and only as a fallback a repo overrides.
 */
export const resolveQueueSettings = ({ config }: Params): QueueSettings | QueueFailure => {
	const queue = config.queue;

	if (queue === undefined) {
		return { error: '`lightsout queue` needs a `queue` block in lightsout.config.json naming max-parallel' };
	}

	const lifecycle = resolveLifecycleSettings({ config });

	if ('error' in lifecycle) {
		return lifecycle;
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
		lifecycle,
		maxParallel: queue['max-parallel'],
		setup: queue.setup,
		branchTemplate: queue['branch-template'] ?? '{ticket}-{slug}',
		decisionsHeading: queue['decisions-heading'] ?? '## Decisions',
		workerTimeoutMs,
		questionTimeoutMs,
		parkedLabel: queue['parked-label'],
	};
};
