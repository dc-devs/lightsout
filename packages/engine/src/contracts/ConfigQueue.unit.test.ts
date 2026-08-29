import { describe, expect, test } from '@jest/globals';
import { ConfigQueue } from '#src/contracts/index.ts';

const minimal = {
	tracker: 'linear',
	team: 'LO',
	'route-labels': { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	'max-parallel': 3,
	'api-key-env': 'LINEAR_API_KEY',
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
			'worker-minutes': 90,
		});

		expect(parsed['branch-template']).toBe('feature/{ticket}-{slug}');
		expect(parsed['eligible-statuses']).toStrictEqual(['Backlog']);
		expect(parsed['worker-minutes']).toBe(90);
	});

	test('accepts the five required keys alone, because every other key has an engine default behind it', () => {
		const parsed = ConfigQueue.parse(minimal);

		expect(parsed).toStrictEqual(minimal);
	});

	test('refuses a block with no tracker connection, because a queue that cannot read a backlog has nothing to drain', () => {
		expect(ConfigQueue.safeParse({ team: 'LO' }).success).toBe(false);
	});

	test('refuses a tracker with no adapter behind it, rather than failing at the first query', () => {
		expect(ConfigQueue.safeParse({ ...minimal, tracker: 'jira' }).success).toBe(false);
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
