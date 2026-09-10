import { describe, expect, test } from '@jest/globals';
import { WorktreeRecord } from '#src/contracts/index.ts';

const record = {
	branch: 'lo-140-run-implement-in-a-new-worktree',
	owner: 'implement',
	worktreePath: '/Users/dev/code/lightsout-worktrees/lo-140-run-implement-in-a-new-worktree',
	createdAt: '2026-01-01T00:00:00.000Z',
};

describe('WorktreeRecord', () => {
	test('refuses an owner outside the two the const object declares', () => {
		const unknownOwner = WorktreeRecord.safeParse({ ...record, owner: 'refactor' });

		expect(unknownOwner.success).toBe(false);
		expect(WorktreeRecord.parse({ ...record, owner: 'queue' }).owner).toBe('queue');
		expect(WorktreeRecord.parse(record).owner).toBe('implement');
	});
});
