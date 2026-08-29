import { describe, expect, test } from '@jest/globals';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';

describe('getWorktreesRoot', () => {
	test('answers a sibling of the repo, never a directory inside it — a nested worktree confuses anything that walks up for a repo root', () => {
		expect(getWorktreesRoot({ cwd: '/work/acme' })).toBe('/work/acme-worktrees');
	});

	test('resolves a relative cwd first, so the answer never carries a `..` segment', () => {
		const root = getWorktreesRoot({ cwd: '.' });

		expect(root.includes('..')).toBe(false);
		expect(root.endsWith('-worktrees')).toBe(true);
	});

	test('ignores a trailing separator, so `/work/acme/` and `/work/acme` name one directory', () => {
		expect(getWorktreesRoot({ cwd: '/work/acme/' })).toBe(getWorktreesRoot({ cwd: '/work/acme' }));
	});
});
