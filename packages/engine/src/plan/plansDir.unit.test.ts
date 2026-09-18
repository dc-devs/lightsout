import { execSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { plansDir } from '#src/plan/plansDir.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree cut from it — the shape a plan
 * command runs in whenever `plan.worktree` moves the session into a tree.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-150-planning-observability');

	execSync(`git worktree add -q -b lo-150-planning-observability "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

/** A directory with no repository above it, so git can answer nothing. */
const setupLooseDirectory = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plans-dir-'));

	return { cwd };
};

describe('plansDir', () => {
	test("answers the primary checkout's plans directory from inside a linked worktree", async () => {
		const { primary, worktree } = setupLinkedWorktree();

		const plansPath = await plansDir({ cwd: worktree });

		expect({
			root: realpathSync(dirname(dirname(plansPath))),
			tail: join(basename(dirname(plansPath)), basename(plansPath)),
		}).toStrictEqual({ root: realpathSync(primary), tail: join('.lightsout', 'plans') });
	});

	test('falls back to the given directory outside a repository', async () => {
		const { cwd } = setupLooseDirectory();

		const plansPath = await plansDir({ cwd });

		expect(plansPath).toBe(join(cwd, '.lightsout', 'plans'));
	});
});
