import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { isWholePlanRun } from '#src/ticket/common/utils/isWholePlanRun.ts';
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
	const folder = join(cwd, '.lightsout', 'plans', 'lo-150');

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'plan.md'), '# the plan\n');
	writeFileSync(join(folder, 'overview.md'), '# the overview\n');
	writeFileSync(join(folder, 'phase1-activity-record.md'), '# phase one\n');
	execSync(`git worktree add -q -b lo-150-activity-record "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { worktree };
};

describe('isWholePlanRun', () => {
	test('a whole-plan run recorded repo-relative is recognised from a linked worktree', async () => {
		const { worktree } = setupLinkedWorktree();
		const ask = (planPath: string) => isWholePlanRun({ cwd: worktree, name: 'lo-150', planPath });

		const answers = {
			plan: await ask('.lightsout/plans/lo-150/plan.md'),
			overview: await ask('.lightsout/plans/lo-150/overview.md'),
			phase: await ask('.lightsout/plans/lo-150/phase1-activity-record.md'),
		};

		expect(answers).toStrictEqual({ plan: true, overview: true, phase: false });
	});
});
