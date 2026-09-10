import { describe, expect, test } from '@jest/globals';
import { ConfigWorktree } from '#src/contracts/index.ts';

describe('ConfigWorktree', () => {
	test('accepts the block a repo actually writes, keeping the file’s own spelling', () => {
		const parsed = ConfigWorktree.parse({ setup: 'pnpm install' });

		expect(parsed).toStrictEqual({ setup: 'pnpm install' });
	});

	test('accepts an empty block, because a repo may need no preparation command at all', () => {
		const parsed = ConfigWorktree.parse({});

		expect(parsed).toStrictEqual({});
	});

	test('refuses an unknown key and a setup command that is not a string', () => {
		expect(ConfigWorktree.safeParse({ setups: 'pnpm install' }).success).toBe(false);
		expect(ConfigWorktree.safeParse({ setup: 3 }).success).toBe(false);
	});
});
