import type { QueueSettings } from '#src/queue/index.ts';

/**
 * A resolved `queue` block for tests, with whatever the test is actually about
 * overridden.
 *
 * One copy rather than one per test file: the settings are what
 * `resolveQueueSettings` guarantees every queue step, so a new field must be
 * added in one place or the files that forgot it stop compiling for no reason a
 * reader can act on.
 */
export const queueSettingsFixture = (overrides: Partial<QueueSettings> = {}): QueueSettings => ({
	routeLabels: { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	maxParallel: 2,
	eligibleStatuses: ['Backlog'],
	inProgressStatus: 'In Progress',
	branchTemplate: '{ticket}-{slug}',
	decisionsHeading: '## Decisions',
	workerTimeoutMs: 14_400_000,
	questionTimeoutMs: 3_600_000,
	...overrides,
});
