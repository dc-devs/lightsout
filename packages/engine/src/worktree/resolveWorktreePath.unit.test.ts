import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveWorktreePath } from '#src/worktree/index.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';

/**
 * A checkout with no repository above it, so the worktrees root is the
 * checkout's own sibling and nothing depends on where the suite is run from.
 *
 * It holds two records: one whose branch is its own label, and one whose branch
 * carries a prefix the label does not — a work order created from a prefixed
 * `queue.branch-template` stores a branch its label never spells, so only the
 * record can say which label a branch belongs to.
 */
const setupCheckout = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-resolve-worktree-path-'));

	seedWorkOrderRecord({ cwd, name: 'lo-1-alpha', branch: 'lo-1-alpha' });
	seedWorkOrderRecord({ cwd, name: 'lo-2-beta', branch: 'feature/lo-2-beta' });

	return { cwd, worktreesRoot: `${cwd}-worktrees` };
};

describe('resolveWorktreePath', () => {
	test("puts a prefixed branch's tree at the work order's label, not under the prefix", async () => {
		const { cwd, worktreesRoot } = setupCheckout();

		const worktreePath = await resolveWorktreePath({ cwd, branch: 'feature/lo-2-beta' });

		// one directory under the root, never a `feature/` level above the tree
		expect({ worktreePath, nestedUnderThePrefix: worktreePath.includes('feature') }).toStrictEqual({
			worktreePath: join(worktreesRoot, 'lo-2-beta'),
			nestedUnderThePrefix: false,
		});
	});

	test('falls back to the branch itself when no work order claims it', async () => {
		const { cwd, worktreesRoot } = setupCheckout();

		const worktreePath = await resolveWorktreePath({ cwd, branch: 'lo-3-gamma' });

		expect(worktreePath).toBe(join(worktreesRoot, 'lo-3-gamma'));
	});
});
