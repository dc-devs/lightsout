import { describe, expect, test } from '@jest/globals';
import { ConfigQueue } from '#src/contracts/index.ts';

const minimal = {
	tracker: 'linear',
	team: 'LO',
	'route-labels': { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	'max-parallel': 3,
	'api-key-env': 'LINEAR_API_KEY',
};

const minimalJira = {
	tracker: 'jira',
	'site-url': 'https://example.atlassian.net/',
	project: 'LO',
	'api-user-email-env': 'JIRA_ACCOUNT_EMAIL',
	'route-labels': minimal['route-labels'],
	'max-parallel': 3,
	'api-key-env': 'JIRA_API_TOKEN',
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

	test('accepts the five required keys alone, because every other key has an engine default behind it', () => {
		const parsed = ConfigQueue.parse(minimal);

		expect(parsed).toStrictEqual(minimal);
	});

	test('refuses a block with no tracker connection, because a queue that cannot read a backlog has nothing to drain', () => {
		expect(ConfigQueue.safeParse({ team: 'LO' }).success).toBe(false);
	});

	test('refuses a tracker with no adapter behind it, rather than failing at the first query', () => {
		expect(ConfigQueue.safeParse({ ...minimal, tracker: 'github' }).success).toBe(false);
	});

	test('accepts Jira Cloud only with its complete tracker-specific connection', () => {
		const parsed = ConfigQueue.parse(minimalJira);

		expect(parsed).toStrictEqual(minimalJira);
	});

	test.each([
		{ key: 'site-url', value: undefined },
		{ key: 'project', value: undefined },
		{ key: 'project', value: '' },
		{ key: 'api-user-email-env', value: undefined },
		{ key: 'api-user-email-env', value: '' },
	])('refuses Jira without a usable $key', ({ key, value }) => {
		const parsed = ConfigQueue.safeParse({ ...minimalJira, [key]: value });

		expect(parsed.success).toBe(false);
	});

	test('refuses Linear-only connection fields on Jira', () => {
		const parsed = ConfigQueue.safeParse({ ...minimalJira, team: 'LO' });

		expect(parsed.success).toBe(false);
	});

	test.each([
		'not a URL',
		'http://example.atlassian.net',
		'https://example.com',
		'https://example.atlassian.net/path',
		'https://example.atlassian.net?query=yes',
		'https://example.atlassian.net#fragment',
	])('refuses a Jira site URL outside the normalized Cloud origin boundary', (siteUrl) => {
		const parsed = ConfigQueue.safeParse({ ...minimalJira, 'site-url': siteUrl });

		expect(parsed.success).toBe(false);
	});

	test('keeps tracker branch keys exclusive', () => {
		expect(ConfigQueue.safeParse({ ...minimal, project: 'LO' }).success).toBe(false);
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
