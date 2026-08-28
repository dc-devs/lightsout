import { describe, expect, test } from '@jest/globals';
import { ShipResult } from '#src/contracts/index.ts';

describe('ShipResult', () => {
	test('a shipped result carries everything a tracker comment is built from', () => {
		const parsed = ShipResult.parse({
			status: 'shipped',
			branch: 'lo-60-ship-command',
			ticketRef: 'lo-60',
			prNumber: 41,
			prUrl: 'https://forge.example/acme/repo/pull/41',
			prTitle: 'Ship a branch and write a typed result',
			mergeCommit: '0f1e2d3',
			mergedAt: '2026-08-28T10:00:00.000Z',
		});

		expect(parsed).toEqual(expect.objectContaining({ status: 'shipped', ticketRef: 'lo-60', prNumber: 41, mergeCommit: '0f1e2d3' }));
	});

	test('a block before the branch name is known parses with nothing but its status and reason', () => {
		const parsed = ShipResult.parse({ status: 'blocked', reason: 'git-unreadable', detail: 'not on a branch' });

		expect(parsed).toStrictEqual({ status: 'blocked', reason: 'git-unreadable', detail: 'not on a branch', failingChecks: [] });
	});

	test('fills in an empty failing-check list, so a reader never has to guard the field', () => {
		const parsed = ShipResult.parse({ status: 'blocked', reason: 'merge-rejected' });

		expect(parsed.failingChecks).toStrictEqual([]);
	});

	test('refuses a status that is neither of the two outcomes, since every "why not" belongs in the reason', () => {
		const parsed = ShipResult.safeParse({ status: 'checks-failed' });

		expect(parsed.success).toBe(false);
	});

	test('refuses a block reason the engine does not name', () => {
		const parsed = ShipResult.safeParse({ status: 'blocked', reason: 'tracker-unreachable' });

		expect(parsed.success).toBe(false);
	});
});
