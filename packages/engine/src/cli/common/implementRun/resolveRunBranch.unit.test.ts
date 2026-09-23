import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveRunBranch } from '#src/cli/common/implementRun/resolveRunBranch.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree added from it — the shape an
 * implement run takes once a plan command moved the session into a tree. The
 * work order's record is the primary checkout's, so a branch resolved from the
 * worktree proves the record is found through the primary.
 */
const setupWorktreeRepo = () => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', 'lo-7-search');
	const folder = join(primary, '.lightsout', 'work-orders', 'lo-7-search');

	execSync(`git worktree add -q -b lo-7-search "${worktree}" main`, { cwd: primary, stdio: 'ignore' });
	mkdirSync(folder, { recursive: true });
	writeFileSync(
		join(folder, 'state.json'),
		JSON.stringify({ schemaVersion: 1, name: 'lo-7-search', branch: 'lo-7-search', ticketRef: 'LO-7', mode: 'multiple-plan', plans: [], history: [] }),
	);

	return { worktree };
};

/**
 * A checkout outside any repository holding one work order whose record stores a
 * branch its own label does not spell — the shape a prefixed
 * `queue.branch-template` leaves behind, and the only arrangement that can tell
 * a stored branch apart from the plan address's first segment.
 */
const setupWorkOrderCheckout = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-resolve-run-branch-'));
	const folder = join(cwd, '.lightsout', 'work-orders', 'lo-7-search');

	mkdirSync(folder, { recursive: true });
	writeFileSync(
		join(folder, 'state.json'),
		JSON.stringify({
			schemaVersion: 1,
			name: 'lo-7-search',
			branch: 'feature/lo-7-search',
			ticketRef: 'LO-7',
			mode: 'multiple-plan',
			plans: [],
			history: [],
		}),
	);

	return { cwd };
};

describe('resolveRunBranch', () => {
	test("answers the branch the work order's record stores", async () => {
		const { cwd } = setupWorkOrderCheckout();

		const branch = await resolveRunBranch({ cwd, planPath: '.lightsout/work-orders/lo-7-search/plans/002-ranking/plan.md' });

		// the address's first segment is 'lo-7-search', so the prefix is what
		// proves the branch was read from the record rather than from the address
		expect(branch).toBe('feature/lo-7-search');
	});

	test("answers the branch the work order's record stores for a --ref a direct run named", async () => {
		const { cwd } = setupWorkOrderCheckout();

		const branch = await resolveRunBranch({ cwd, ticketPath: 'work-orders/lo-7.md', ticketRef: 'lo-7' });

		// the reference is matched against the record's own, whatever either spells it as
		expect(branch).toBe('feature/lo-7-search');
	});

	test("a plans-directory plan path still answers its work order's branch when resolved from a linked worktree", async () => {
		const { worktree } = setupWorktreeRepo();

		const branch = await resolveRunBranch({ cwd: worktree, planPath: '.lightsout/work-orders/lo-7-search/plans/002-ranking/plan.md' });

		// the record lives in the primary checkout, so an answer at all proves the
		// look-up resolved the primary rather than the tree it was asked from
		expect(branch).toBe('lo-7-search');
	});

	test('refuses an input that names no work order instead of deriving a branch from it', async () => {
		const { cwd } = setupWorkOrderCheckout();

		const branch = await resolveRunBranch({ cwd, ticketPath: 'work-orders/LO-9 Add Worktree.md' });

		expect(branch).toEqual({ error: expect.stringContaining('work-orders/LO-9 Add Worktree.md') });
		expect(branch).toEqual({ error: expect.stringContaining('--no-worktree') });
	});

	test('refuses a plan path whose work order has no record, rather than planning on the address', async () => {
		const { cwd } = setupWorkOrderCheckout();

		const branch = await resolveRunBranch({ cwd, planPath: '.lightsout/work-orders/lo-9-nobody/plans/001-a/plan.md' });

		expect(branch).toEqual({ error: expect.stringContaining('lo-9-nobody') });
		expect(branch).toEqual({ error: expect.stringContaining('--no-worktree') });
	});
});
