import { describe, expect, test } from '@jest/globals';
import { ConfigTicketTracker } from '#src/contracts/index.ts';

const block = { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' };

describe('ConfigTicketTracker', () => {
	test('accepts the block a repo actually writes, keeping the file’s own kebab-case spelling', () => {
		const parsed = ConfigTicketTracker.parse(block);

		// tracker identity is one fact, spelled once — the parsed value has to
		// carry it exactly as the file wrote it, or the queue and the plan publish
		// path could read two different teams
		expect(parsed).toStrictEqual({ provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' });
	});

	test.each([
		{ missing: 'provider', partial: { team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
		{ missing: 'team', partial: { provider: 'linear', 'api-key-env': 'LINEAR_API_KEY' } },
		{ missing: 'api-key-env', partial: { provider: 'linear', team: 'LO' } },
	])('refuses a block with no $missing, because a query can only be addressed when all three are named', ({ partial }) => {
		expect(ConfigTicketTracker.safeParse(partial).success).toBe(false);
	});

	test('refuses a provider the engine has no adapter for, rather than failing at the first query of a drain', () => {
		expect(ConfigTicketTracker.safeParse({ ...block, provider: 'jira' }).success).toBe(false);
	});

	test.each([
		{ key: 'team', value: 42 },
		{ key: 'api-key-env', value: true },
	])('refuses a non-string $key, because the value is read as a name at run time', ({ key, value }) => {
		expect(ConfigTicketTracker.safeParse({ ...block, [key]: value }).success).toBe(false);
	});

	test('refuses a key it does not know — a typo here would silently disable a setting the file believes is on', () => {
		expect(ConfigTicketTracker.safeParse({ ...block, 'api-key-nev': 'LINEAR_API_KEY' }).success).toBe(false);
	});
});
