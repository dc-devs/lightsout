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
			workerMinutes: 240,
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
				'worker-minutes': 30,
			}),
			env: { LINEAR_API_KEY: 'lin_key' },
		});

		expect(settings).toMatchObject({
			eligibleStatuses: ['Todo'],
			inProgressStatus: 'Building',
			setup: 'pnpm install',
			branchTemplate: 'feature/{ticket}',
			decisionsHeading: '## Settled',
			workerMinutes: 30,
		});
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
