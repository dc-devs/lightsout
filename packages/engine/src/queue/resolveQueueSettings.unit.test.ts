import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { resolveQueueSettings } from '#src/queue/index.ts';

const queueBlock = {
	tracker: 'linear',
	team: 'LO',
	'route-labels': { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	'max-parallel': 3,
	'api-key-env': 'LINEAR_API_KEY',
} as const;

const configOf = (queue?: LightsoutConfig['queue']): LightsoutConfig => ({ gates: { check: 'true', test: 'true', 'test-coverage': false }, queue });

describe('resolveQueueSettings', () => {
	test('applies every default, so no step downstream re-decides one', () => {
		const settings = resolveQueueSettings({ config: configOf({ ...queueBlock }), env: { LINEAR_API_KEY: 'lin_key' } });

		expect(settings).toStrictEqual({
			team: 'LO',
			routeLabels: { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
			maxParallel: 3,
			apiKey: 'lin_key',
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

	test('refuses a config with no queue block, naming what the block has to say', () => {
		const settings = resolveQueueSettings({ config: configOf(), env: {} });

		expect(settings).toStrictEqual({
			error: '`lightsout queue` needs a `queue` block in lightsout.config.json naming tracker, team, route-labels, max-parallel and api-key-env',
		});
	});

	test('refuses a missing API key by naming the variable to set — a missing block and a missing key are two different things to fix', () => {
		const settings = resolveQueueSettings({ config: configOf({ ...queueBlock }), env: {} });

		expect(settings).toStrictEqual({ error: "the queue's tracker API key is missing: set the `LINEAR_API_KEY` environment variable" });
	});

	test('treats an empty variable as absent, because an empty key authenticates nothing', () => {
		const settings = resolveQueueSettings({ config: configOf({ ...queueBlock }), env: { LINEAR_API_KEY: '' } });

		expect('error' in settings).toBe(true);
	});
});
