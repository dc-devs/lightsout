import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@jest/globals';
import { sourceEvidencePath } from '#src/plan/evidence/sourceEvidencePath.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A repo root the cases resolve against — nothing is read from disk, so it need not exist. */
const cwd = resolve('/repo');

test("sourceEvidencePath: the evidence record sits inside the plan's own workspace folder", async () => {
	const forOnePlan = await sourceEvidencePath({ cwd, name: 'lo-142-focused-drafting' });
	const forAnother = await sourceEvidencePath({ cwd, name: 'rate-limit-banner' });

	// spelled out segment by segment rather than built from the helper under
	// test, so a record that moved out of the plan folder — or into a shared
	// one every plan would overwrite — fails here instead of agreeing with itself
	expect(forOnePlan).toBe(join(cwd, '.lightsout', 'work-orders', 'lo-142-focused-drafting', 'plans', 'source-evidence.json'));
	expect(forAnother).toBe(join(cwd, '.lightsout', 'work-orders', 'rate-limit-banner', 'plans', 'source-evidence.json'));
});

/**
 * A primary checkout with a linked worktree cut from it — the shape a drafting
 * session runs in once `plan.worktree` moves it into a tree, and the one place
 * a collected record could be written somewhere that is removed after shipping.
 */
const setupLinkedWorktree = () => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', 'lo-142-focused-drafting');

	execSync(`git worktree add -q -b lo-142-focused-drafting "${worktree}" main`, { cwd: primary, stdio: 'ignore' });

	return { primary, worktree };
};

test("sourceEvidencePath: the record asked for from a linked worktree is the primary checkout's own", async () => {
	const { primary, worktree } = setupLinkedWorktree();

	const path = await sourceEvidencePath({ cwd: worktree, name: 'lo-142-focused-drafting' });

	// a grade run from any other checkout reads the evidence this draft collected,
	// which it cannot do if each tree keeps its own copy and then loses it
	expect(path).toBe(join(realpathSync(primary), '.lightsout', 'work-orders', 'lo-142-focused-drafting', 'plans', 'source-evidence.json'));
});
