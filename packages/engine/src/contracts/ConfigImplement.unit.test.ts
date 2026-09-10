import { describe, expect, test } from '@jest/globals';
import { ConfigImplement } from '#src/contracts/index.ts';

describe('ConfigImplement', () => {
	test('accepts the block a repo actually writes, keeping the file’s own kebab-case spelling', () => {
		const parsed = ConfigImplement.parse({ refactor: { 'max-rounds': 5 } });

		expect(parsed).toStrictEqual({ refactor: { 'max-rounds': 5 } });
	});

	test('accepts an empty block, because the round budget has a documented default behind it', () => {
		expect(ConfigImplement.parse({})).toStrictEqual({});
		expect(ConfigImplement.parse({ refactor: {} })).toStrictEqual({ refactor: {} });
	});

	test('refuses a round budget that is not a whole number above zero', () => {
		expect(ConfigImplement.safeParse({ refactor: { 'max-rounds': 0 } }).success).toBe(false);
		expect(ConfigImplement.safeParse({ refactor: { 'max-rounds': -1 } }).success).toBe(false);
		expect(ConfigImplement.safeParse({ refactor: { 'max-rounds': 2.5 } }).success).toBe(false);
	});

	test('refuses a key it does not know, at either level — a typo would silently leave the default in force', () => {
		expect(ConfigImplement.safeParse({ refactors: { 'max-rounds': 3 } }).success).toBe(false);
		expect(ConfigImplement.safeParse({ refactor: { 'max-round': 3 } }).success).toBe(false);
	});

	test('refuses a round budget written as anything but a number, and a refactor block written as anything but a block', () => {
		expect(ConfigImplement.safeParse({ refactor: { 'max-rounds': '5' } }).success).toBe(false);
		expect(ConfigImplement.safeParse({ refactor: 2 }).success).toBe(false);
	});

	test('accepts the worktree switch as a boolean either way and refuses it written as a string', () => {
		expect(ConfigImplement.parse({ worktree: true })).toStrictEqual({ worktree: true });
		expect(ConfigImplement.parse({ worktree: false })).toStrictEqual({ worktree: false });
		expect(ConfigImplement.safeParse({ worktree: 'yes' }).success).toBe(false);
	});

	test('leaves the worktree switch optional, so a block written before it existed still parses', () => {
		expect(ConfigImplement.parse({ refactor: { 'max-rounds': 2 } })).toStrictEqual({
			refactor: { 'max-rounds': 2 },
		});
		expect(ConfigImplement.parse({})).toStrictEqual({});
	});
});
