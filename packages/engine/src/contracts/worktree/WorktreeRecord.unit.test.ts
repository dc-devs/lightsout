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

	test('accepts a plan-owned record carrying its start point, and still refuses an owner nothing declares', () => {
		const planOwnedRecord = {
			...record,
			owner: 'plan',
			startPoint: '9c4e2f7a1b3d5e6f8091a2b3c4d5e6f708192a3b',
		};

		const planOwned = WorktreeRecord.safeParse(planOwnedRecord);
		const unknownOwner = WorktreeRecord.safeParse({ ...record, owner: 'refactor' });
		const olderRecord = WorktreeRecord.parse(record);

		expect(planOwned.success).toBe(true);
		expect(planOwned.data).toStrictEqual(planOwnedRecord);
		expect(unknownOwner.success).toBe(false);
		expect(olderRecord).toStrictEqual(record);
		expect(olderRecord).not.toHaveProperty('startPoint');
	});
});
