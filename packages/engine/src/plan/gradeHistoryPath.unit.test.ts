import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { gradeHistoryPath } from '#src/plan/gradeHistoryPath.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A repo root the naming cases resolve against — nothing is read from disk, so it need not exist. */
const looseCwd = resolve('/repo');

/**
 * A primary checkout with a linked worktree cut from it — the shape a grading
 * pass runs in once `plan.worktree` moves the session into a tree, and the one
 * place a ledger could be appended to somewhere that is removed after shipping.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-150-planning-observability');

	execSync(`git worktree add -q -b lo-150-planning-observability "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

describe('gradeHistoryPath', () => {
	// spelled out segment by segment rather than built from the helper under
	// test, so a ledger that moved out of the plan folder — or into a shared one
	// every plan would append to — fails here instead of agreeing with itself
	test.each([{ name: 'lo-150-planning-observability' }, { name: 'rate-limit-banner' }])(
		"the ledger for $name sits inside that plan's own workspace folder",
		async ({ name }) => {
			const path = await gradeHistoryPath({ cwd: looseCwd, name });

			expect(path).toBe(join(planWorkspaceFolder({ cwd: looseCwd, name: name }), 'grade-history.jsonl'));
		},
	);

	test("answers the primary checkout's ledger from inside a linked worktree", async () => {
		const { primary, worktree } = setupLinkedWorktree();

		const path = await gradeHistoryPath({ cwd: worktree, name: 'lo-150-planning-observability' });

		// a pass graded from a tree appends to the ledger that outlives it, so the
		// C → B → A history is one file rather than one per checkout
		expect(path).toBe(join(realpathSync(primary), '.lightsout', 'work-orders', 'lo-150-planning-observability', 'plans', 'grade-history.jsonl'));
	});
});
