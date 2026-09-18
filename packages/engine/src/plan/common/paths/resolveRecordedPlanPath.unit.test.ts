import { execSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveRecordedPlanPath } from '#src/plan/common/paths/resolveRecordedPlanPath.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout holding a plan folder, with a linked worktree added from
 * it — the shape a run works in once plan data stays in the main checkout, and
 * the one place a recorded plan path can name a file that is not there.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-150-activity-record');

	mkdirSync(join(cwd, '.lightsout', 'plans', 'lo-150'), { recursive: true });
	writeFileSync(join(cwd, '.lightsout', 'plans', 'lo-150', 'plan.md'), '# the plan\n');
	execSync(`git worktree add -q -b lo-150-activity-record "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

describe('resolveRecordedPlanPath', () => {
	test('a recorded plans-directory path read from a worktree resolves into the primary checkout', async () => {
		const { primary, worktree } = setupLinkedWorktree();

		const resolved = await resolveRecordedPlanPath({ cwd: worktree, path: '.lightsout/plans/lo-150/plan.md' });

		expect(realpathSync(resolved)).toBe(realpathSync(join(primary, '.lightsout', 'plans', 'lo-150', 'plan.md')));
	});

	test('a recorded path outside the plans directory resolves against the given checkout', async () => {
		const { worktree } = setupLinkedWorktree();

		const resolved = await resolveRecordedPlanPath({ cwd: worktree, path: '.lightsout/runs/lo-150-run/inputs/notes.md' });

		expect(resolved).toBe(join(worktree, '.lightsout', 'runs', 'lo-150-run', 'inputs', 'notes.md'));
	});

	test('an absolute path is answered unchanged and a legacy plans path stays with its checkout', async () => {
		const { primary, worktree } = setupLinkedWorktree();
		const absolute = join(primary, '.lightsout', 'plans', 'lo-150', 'plan.md');

		const resolved = {
			absolute: await resolveRecordedPlanPath({ cwd: worktree, path: absolute }),
			legacy: await resolveRecordedPlanPath({ cwd: worktree, path: '.claude/plans/lo-150/plan.md' }),
		};

		expect(resolved).toStrictEqual({
			absolute,
			legacy: join(worktree, '.claude', 'plans', 'lo-150', 'plan.md'),
		});
	});
});
