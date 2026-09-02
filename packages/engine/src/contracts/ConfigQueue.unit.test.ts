import { describe, expect, test } from '@jest/globals';
import { ConfigQueue } from '#src/contracts/index.ts';

const minimal = {
	'route-labels': { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	'max-parallel': 3,
};

describe('ConfigQueue', () => {
	test('accepts the block a repo actually writes, keeping the file’s own kebab-case spelling', () => {
		const parsed = ConfigQueue.parse({
			...minimal,
			'eligible-statuses': ['Backlog'],
			'in-progress-status': 'Building',
			setup: 'pnpm install',
			'branch-template': 'feature/{ticket}-{slug}',
			'decisions-heading': '## Settled',
			'worker-timeout': '90m',
			'question-timeout': '30m',
			'parked-label': 'queue-parked',
		});

		expect(parsed['branch-template']).toBe('feature/{ticket}-{slug}');
		expect(parsed['eligible-statuses']).toStrictEqual(['Backlog']);
		expect(parsed['worker-timeout']).toBe('90m');
		expect(parsed['question-timeout']).toBe('30m');
		expect(parsed['parked-label']).toBe('queue-parked');
	});

	test('refuses the retired `worker-minutes` key, because a silently ignored ceiling is worse than a refusal', () => {
		expect(ConfigQueue.safeParse({ ...minimal, 'worker-minutes': 90 }).success).toBe(false);
	});

	test.each([
		{ key: 'worker-timeout', value: 240 },
		{ key: 'question-timeout', value: 60 },
		{ key: 'parked-label', value: true },
	])('refuses a non-string $key, because the value has to carry its own unit or name', ({ key, value }) => {
		expect(ConfigQueue.safeParse({ ...minimal, [key]: value }).success).toBe(false);
	});

	test('accepts the two required keys alone, because every other key has an engine default behind it', () => {
		const parsed = ConfigQueue.parse(minimal);

		expect(parsed).toStrictEqual(minimal);
	});

	test('refuses a block naming no route, because a queue with no label to read has nothing to pick up', () => {
		expect(ConfigQueue.safeParse({ 'max-parallel': 3 }).success).toBe(false);
	});

	test.each([
		{ key: 'tracker', to: 'ticket-tracker.provider' },
		{ key: 'team', to: 'ticket-tracker.team' },
		{ key: 'api-key-env', to: 'ticket-tracker.api-key-env' },
	])('refuses the moved `queue.$key` spelling, naming $to — a silently stripped identity would leave the queue querying nothing', ({ key, to }) => {
		const parsed = ConfigQueue.safeParse({ ...minimal, [key]: 'linear' });

		expect(parsed.success).toBe(false);
		// the message is the whole point of the rejection — a stripped identity key
		// would leave the queue querying a team nobody named
		expect(parsed.error?.message ?? '').toMatch(new RegExp(`\`queue.${key}\` was renamed to \`${to}\``));
	});

	test('refuses a parallelism that is not a whole number of tickets', () => {
		expect(ConfigQueue.safeParse({ ...minimal, 'max-parallel': 0 }).success).toBe(false);
		expect(ConfigQueue.safeParse({ ...minimal, 'max-parallel': 1.5 }).success).toBe(false);
	});

	test('refuses a route-labels block naming a route the engine has no worker for', () => {
		expect(ConfigQueue.safeParse({ ...minimal, 'route-labels': { ...minimal['route-labels'], review: 'route-review' } }).success).toBe(false);
	});

	test('refuses a key it does not know — a typo here would silently disable a setting the file believes is on', () => {
		expect(ConfigQueue.safeParse({ ...minimal, 'max-parralel': 2 }).success).toBe(false);
	});
});
