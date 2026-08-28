import { describe, expect, test } from '@jest/globals';
import { ConfigShip } from '#src/contracts/index.ts';

describe('ConfigShip', () => {
	test('accepts the block a repo actually writes, keeping the file’s own kebab-case spelling', () => {
		const parsed = ConfigShip.parse({ 'ticket-pattern': '^(?<ticket>lo-\\d+)', 'pr-body': '{ticket}', 'merge-method': 'squash', 'after-implement': true });

		expect(parsed).toStrictEqual({
			'ticket-pattern': '^(?<ticket>lo-\\d+)',
			'pr-body': '{ticket}',
			'merge-method': 'squash',
			'after-implement': true,
		});
	});

	test('accepts an empty block, because every key has an engine default behind it', () => {
		const parsed = ConfigShip.parse({});

		expect(parsed).toStrictEqual({});
	});

	test('refuses a merge method no forge offers, rather than passing it through to the command line', () => {
		const parsed = ConfigShip.safeParse({ 'merge-method': 'fast-forward' });

		expect(parsed.success).toBe(false);
	});

	test('refuses a key it does not know — a typo here would silently disable a setting the file believes is on', () => {
		const parsed = ConfigShip.safeParse({ 'ticket-patern': '^(?<ticket>lo-\\d+)' });

		expect(parsed.success).toBe(false);
	});
});
