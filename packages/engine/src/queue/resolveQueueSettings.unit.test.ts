import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { resolveQueueSettings } from '#src/queue/index.ts';

const queueBlock = { 'max-parallel': 3 } as const;

const configOf = (queue?: LightsoutConfig['queue']): LightsoutConfig => ({ gates: { check: 'true', test: 'true', 'test-coverage': false }, queue });

describe('resolveQueueSettings', () => {
	test('applies every default, so no step downstream re-decides one', () => {
		const settings = resolveQueueSettings({ config: configOf({ ...queueBlock }), env: { LINEAR_API_KEY: 'lin_key' } });

		expect(settings).toStrictEqual({
			lifecycle: {
				planningStatusLabels: {
					'planning-needs-brainstorm': 'planning-needs-brainstorm',
					'planning-needs-plan': 'planning-needs-plan',
					'planning-ready-auto-plan': 'planning-ready-auto-plan',
					'planning-complete': 'planning-complete',
					'planning-not-needed': 'planning-not-needed',
				},
				statusNames: { ready: 'Ready to implement', 'in-progress': 'In Progress', done: 'Done' },
				eligibleStatuses: ['Backlog', 'Ready to implement'],
			},
			maxParallel: 3,
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
				'planning-status-labels': { 'planning-not-needed': 'shaped-none' },
				'eligible-statuses': ['Todo', 'Waiting'],
				'ready-status': 'Waiting',
				'in-progress-status': 'Building',
				'done-status': 'Shipped',
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
			lifecycle: {
				planningStatusLabels: {
					'planning-needs-brainstorm': 'planning-needs-brainstorm',
					'planning-needs-plan': 'planning-needs-plan',
					'planning-ready-auto-plan': 'planning-ready-auto-plan',
					'planning-complete': 'planning-complete',
					'planning-not-needed': 'shaped-none',
				},
				statusNames: { ready: 'Waiting', 'in-progress': 'Building', done: 'Shipped' },
				eligibleStatuses: ['Todo', 'Waiting'],
			},
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
			error: '`lightsout queue` needs a `queue` block in lightsout.config.json naming max-parallel',
		});
	});

	test('refuses a label two planning statuses share, because the queue would report every ticket carrying it ambiguous and skip it forever', () => {
		const settings = resolveQueueSettings({
			config: configOf({ ...queueBlock, 'planning-status-labels': { 'planning-complete': 'shaped', 'planning-not-needed': 'shaped' } }),
			env: { LINEAR_API_KEY: 'lin_key' },
		});

		expect(settings).toStrictEqual({
			error: "`queue.planning-status-labels` maps 'shaped' to both planning-complete and planning-not-needed — one label cannot mean two planning statuses",
		});
	});
});
