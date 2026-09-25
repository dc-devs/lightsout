import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { isWholePlanRun } from '#src/workOrder/internal/common/utils/isWholePlanRun.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout holding a phased plan folder, with a linked worktree added
 * from it — the shape a ticket's run works in once plan data stays in the main
 * checkout, and the one place a manifest's repo-relative plan path is resolved
 * against a checkout that never held the folder.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-150-activity-record');
	const folder = join(cwd, '.lightsout', 'work-orders', 'lo-150', 'plans');

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'plan.md'), '# the plan\n');
	writeFileSync(join(folder, 'overview.md'), '# the overview\n');
	writeFileSync(join(folder, 'phase1-activity-record.md'), '# phase one\n');
	execSync(`git worktree add -q -b lo-150-activity-record "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { worktree };
};

/**
 * A primary checkout holding one ticket with two numbered plans, each with its
 * own deliverable and a phase file — the shape an adopted ticket has, and the
 * one place a plan's own files sit beside another plan's under the same ticket.
 */
const setupTwoPlans = () => {
	const { cwd } = setupBranchRepo();
	const plans = join(cwd, '.lightsout', 'work-orders', 'lo-150', 'plans');

	mkdirSync(join(plans, '001-activity-record'), { recursive: true });
	mkdirSync(join(plans, '002-ship-report'), { recursive: true });
	writeFileSync(join(plans, '001-activity-record', 'plan.md'), '# the plan\n');
	writeFileSync(join(plans, '001-activity-record', 'overview.md'), '# the overview\n');
	writeFileSync(join(plans, '001-activity-record', 'phase1-activity-record.md'), '# phase one\n');
	writeFileSync(join(plans, '002-ship-report', 'plan.md'), '# the other plan\n');

	return { cwd };
};

describe('isWholePlanRun', () => {
	test('a whole-plan run recorded repo-relative is recognised from a linked worktree', async () => {
		const { worktree } = setupLinkedWorktree();
		const ask = (planPath: string) => isWholePlanRun({ cwd: worktree, name: 'lo-150', planPath });

		const answers = {
			plan: await ask('.lightsout/work-orders/lo-150/plans/plan.md'),
			overview: await ask('.lightsout/work-orders/lo-150/plans/overview.md'),
			phase: await ask('.lightsout/work-orders/lo-150/plans/phase1-activity-record.md'),
		};

		expect(answers).toStrictEqual({ plan: true, overview: true, phase: false });
	});

	test("a whole-plan run is the named plan's own deliverable, never a phase file and never another plan's", async () => {
		const { cwd } = setupTwoPlans();
		const ask = (planPath: string) => isWholePlanRun({ cwd, name: 'lo-150/001-activity-record', planPath });

		const answers = {
			plan: await ask('.lightsout/work-orders/lo-150/plans/001-activity-record/plan.md'),
			overview: await ask('.lightsout/work-orders/lo-150/plans/001-activity-record/overview.md'),
			phase: await ask('.lightsout/work-orders/lo-150/plans/001-activity-record/phase1-activity-record.md'),
			otherPlan: await ask('.lightsout/work-orders/lo-150/plans/002-ship-report/plan.md'),
		};

		expect(answers).toStrictEqual({ plan: true, overview: true, phase: false, otherPlan: false });
	});
});
