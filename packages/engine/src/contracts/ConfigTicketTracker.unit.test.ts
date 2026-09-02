import { describe, expect, test } from '@jest/globals';
import { ConfigTicketTracker } from '#src/contracts/index.ts';

const linearBlock = { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } as const;
const jiraBlock = {
	provider: 'jira',
	'site-url': 'https://example.atlassian.net/',
	project: 'LO',
	'api-key-env': 'JIRA_API_TOKEN',
	'api-user-email-env': 'JIRA_ACCOUNT_EMAIL',
} as const;

describe('ConfigTicketTracker', () => {
	test('accepts the block a repo actually writes, keeping the file’s own kebab-case spelling', () => {
		const parsed = ConfigTicketTracker.parse(linearBlock);

		// tracker identity is one fact, spelled once — the parsed value has to
		// carry it exactly as the file wrote it, or the queue and the plan publish
		// path could read two different teams
		expect(parsed).toStrictEqual({ provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' });
	});

	test('accepts a complete Jira Cloud connection at the same top-level boundary', () => {
		expect(ConfigTicketTracker.parse(jiraBlock)).toStrictEqual(jiraBlock);
	});

	test.each([
		{ missing: 'provider', partial: { team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
		{ missing: 'team', partial: { provider: 'linear', 'api-key-env': 'LINEAR_API_KEY' } },
		{ missing: 'api-key-env', partial: { provider: 'linear', team: 'LO' } },
	])('refuses a block with no $missing, because a query can only be addressed when all three are named', ({ partial }) => {
		expect(ConfigTicketTracker.safeParse(partial).success).toBe(false);
	});

	test('refuses a provider the engine has no adapter for, rather than failing at the first query of a drain', () => {
		expect(ConfigTicketTracker.safeParse({ ...linearBlock, provider: 'github' }).success).toBe(false);
	});

	test.each([
		{ key: 'team', value: 42 },
		{ key: 'api-key-env', value: true },
	])('refuses a non-string $key, because the value is read as a name at run time', ({ key, value }) => {
		expect(ConfigTicketTracker.safeParse({ ...linearBlock, [key]: value }).success).toBe(false);
	});

	test('refuses a key it does not know — a typo here would silently disable a setting the file believes is on', () => {
		expect(ConfigTicketTracker.safeParse({ ...linearBlock, 'api-key-nev': 'LINEAR_API_KEY' }).success).toBe(false);
	});

	test.each([
		{ key: 'site-url', value: undefined },
		{ key: 'project', value: undefined },
		{ key: 'project', value: '' },
		{ key: 'api-key-env', value: '' },
		{ key: 'api-user-email-env', value: undefined },
		{ key: 'api-user-email-env', value: '' },
	])('refuses Jira without a usable $key', ({ key, value }) => {
		expect(ConfigTicketTracker.safeParse({ ...jiraBlock, [key]: value }).success).toBe(false);
	});

	test('keeps provider-specific keys exclusive', () => {
		expect(ConfigTicketTracker.safeParse({ ...linearBlock, project: 'LO' }).success).toBe(false);
		expect(ConfigTicketTracker.safeParse({ ...jiraBlock, team: 'LO' }).success).toBe(false);
	});

	test.each([
		'not a URL',
		'http://example.atlassian.net',
		'https://example.com',
		'https://example.atlassian.net/path',
		'https://example.atlassian.net?query=yes',
		'https://example.atlassian.net#fragment',
	])('refuses a Jira site URL outside the normalized Cloud origin boundary', (siteUrl) => {
		expect(ConfigTicketTracker.safeParse({ ...jiraBlock, 'site-url': siteUrl }).success).toBe(false);
	});
});
