import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { PlanVariant } from '#src/contracts/index.ts';
import { planDraftOutputs } from '#src/plan/common/paths/planDraftOutputs.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree cut from it — the shape a draft runs
 * in whenever `plan.worktree` moved the session into a tree that gets removed
 * once its work ships.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-150-planning-observability');

	execSync(`git worktree add -q -b lo-150-planning-observability "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: realpathSync(cwd), worktree };
};

describe('planDraftOutputs', () => {
	test("a single plan is one plan.md inside the plan's own folder", async () => {
		const outputs = await planDraftOutputs({ cwd: '/repo', name: 'add-search', variant: PlanVariant.Single });

		expect(outputs).toStrictEqual([{ path: '/repo/.lightsout/tickets/add-search/plans/plan.md', variant: PlanVariant.Single }]);
	});

	test('a phased plan gets its own folder fronted by an overview', async () => {
		const outputs = await planDraftOutputs({ cwd: '/repo', name: 'add-search', variant: PlanVariant.Overview });

		// only the entry file is dictated — the agent chooses the phase breakdown
		expect(outputs).toStrictEqual([{ path: '/repo/.lightsout/tickets/add-search/plans/overview.md', variant: PlanVariant.Overview }]);
	});

	test("a draft run from a linked worktree is written into the primary checkout's plan folder", async () => {
		const { primary, worktree } = setupLinkedWorktree();

		const outputs = await planDraftOutputs({ cwd: worktree, name: 'lo-150-planning-observability', variant: PlanVariant.Single });

		// written into the tree, the drafted plan would die with the tree — and the
		// grade that follows from another checkout would find nothing to read
		expect(outputs).toStrictEqual([
			{ path: join(primary, '.lightsout', 'tickets', 'lo-150-planning-observability', 'plans', 'plan.md'), variant: PlanVariant.Single },
		]);
	});
});
