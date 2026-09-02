import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { resolveQueueSettings } from '#src/queue/index.ts';

const queueBlock = {
	'route-labels': { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	'max-parallel': 3,
} as const;

const configOf = (queue?: LightsoutConfig['queue']): LightsoutConfig => ({ gates: { check: 'true', test: 'true', 'test-coverage': false }, queue });

describe('resolveQueueSettings', () => {
	test('applies every default, so no step downstream re-decides one', () => {
		const settings = resolveQueueSettings({ config: configOf({ ...queueBlock }), env: { LINEAR_API_KEY: 'lin_key' } });

		expect(settings).toStrictEqual({
			routeLabels: { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
			maxParallel: 3,
			eligibleStatuses: ['Backlog', 'Ready to implement'],
			inProgressStatus: 'In Progress',
			setup: undefined,
			branchTemplate: '{ticket}-{slug}',
			decisionsHeading: '## Decisions',
			workerTimeoutMs: 14_400_000,
			questionTimeoutMs: 3_600_000,
			parkedLabel: undefined,
		});
	});

	test('lets the repo override every opinionated value, because the plugin must not constrain how a team works', () => {
		const settings = resolveQueueSettings({
			config: configOf({
				...queueBlock,
				'eligible-statuses': ['Todo'],
				'in-progress-status': 'Building',
				setup: 'pnpm install',
				'branch-template': 'feature/{ticket}',
				'decisions-heading': '## Settled',
				'worker-timeout': '30m',
				'question-timeout': '90s',
				'parked-label': 'queue-parked',
			}),
			env: { LINEAR_API_KEY: 'lin_key' },
		});

		expect(settings).toMatchObject({
			eligibleStatuses: ['Todo'],
			inProgressStatus: 'Building',
			setup: 'pnpm install',
			branchTemplate: 'feature/{ticket}',
			decisionsHeading: '## Settled',
			workerTimeoutMs: 1_800_000,
			questionTimeoutMs: 90_000,
			parkedLabel: 'queue-parked',
		});
	});

	test('refuses a worker ceiling that is not a duration, naming the key and the forms it accepts', () => {
		const settings = resolveQueueSettings({ config: configOf({ ...queueBlock, 'worker-timeout': '240' }), env: { LINEAR_API_KEY: 'lin_key' } });

		expect(settings).toStrictEqual({ error: "`queue.worker-timeout` must be a duration like '90s', '45m' or '4h' — got '240'" });
	});

	test('refuses a question timeout that is not a duration, so a relayed question never waits on a value nobody can read', () => {
		const settings = resolveQueueSettings({ config: configOf({ ...queueBlock, 'question-timeout': 'soon' }), env: { LINEAR_API_KEY: 'lin_key' } });

		expect(settings).toStrictEqual({ error: "`queue.question-timeout` must be a duration like '90s', '45m' or '4h' — got 'soon'" });
	});

	test('refuses a config with no queue block, naming what the block still has to say', () => {
		const settings = resolveQueueSettings({ config: configOf(), env: {} });

		// it answers only for the `queue` block: the tracker API key is
		// `resolveTrackerSettings`'s to name, and a user hitting one must not be
		// told about the other
		expect(settings).toStrictEqual({
			error: '`lightsout queue` needs a `queue` block in lightsout.config.json naming route-labels and max-parallel',
		});
	});
});
