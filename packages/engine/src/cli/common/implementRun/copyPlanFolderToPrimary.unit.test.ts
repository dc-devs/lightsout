import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { copyPlanFolderToPrimary } from '#src/cli/common/implementRun/copyPlanFolderToPrimary.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const planName = 'lo-131-concurrent-source-edits-invalidate';
const planFolderPath = join('.lightsout', 'plans', planName);
const gradedPlanBody = '# plan\n\ngraded and repaired in the worktree\n';
const olderPlanBody = '# plan\n\nleft in the primary before planning moved\n';
const primaryOnlyBody = 'notes only the primary checkout holds\n';

/**
 * A shipped worktree holding the graded plan folder, beside a primary checkout
 * holding an older copy plus a file the worktree has not got — and a second
 * pair where the worktree holds no folder for the plan at all.
 */
const setupShippedPlanFolder = async () => {
	const worktree = await freshCwd();
	const primary = await freshCwd();
	const emptyWorktree = await freshCwd();
	const untouchedPrimary = await freshCwd();
	const worktreePlanDir = join(worktree, planFolderPath);
	const primaryPlanDir = join(primary, planFolderPath);

	mkdirSync(worktreePlanDir, { recursive: true });
	writeFileSync(join(worktreePlanDir, 'plan.md'), gradedPlanBody);
	mkdirSync(primaryPlanDir, { recursive: true });
	writeFileSync(join(primaryPlanDir, 'plan.md'), olderPlanBody);
	writeFileSync(join(primaryPlanDir, 'primary-only.md'), primaryOnlyBody);

	return { worktree, primary, emptyWorktree, untouchedPrimary, primaryPlanDir };
};

/** A shipped worktree holding a plan folder, beside a primary checkout where a file stands where the state directory belongs. */
const setupUnwritablePrimary = async () => {
	const worktree = await freshCwd();
	const primary = await freshCwd();
	const worktreePlanDir = join(worktree, planFolderPath);

	mkdirSync(worktreePlanDir, { recursive: true });
	writeFileSync(join(worktreePlanDir, 'plan.md'), gradedPlanBody);
	writeFileSync(join(primary, '.lightsout'), 'a file where the state directory belongs\n');

	return { worktree, primary };
};

describe('copyPlanFolderToPrimary', () => {
	test("copies the workspace's plan folder over the primary's and leaves what only the primary has", async () => {
		const { worktree, primary, emptyWorktree, untouchedPrimary, primaryPlanDir } = await setupShippedPlanFolder();

		const saved = await copyPlanFolderToPrimary({ worktree, primary, name: planName });
		const nothingToSave = await copyPlanFolderToPrimary({ worktree: emptyWorktree, primary: untouchedPrimary, name: planName });

		expect(saved).toBeUndefined();
		expect(readdirSync(primaryPlanDir).sort()).toStrictEqual(['plan.md', 'primary-only.md']);
		expect(readFileSync(join(primaryPlanDir, 'plan.md'), 'utf8')).toBe(gradedPlanBody);
		expect(readFileSync(join(primaryPlanDir, 'primary-only.md'), 'utf8')).toBe(primaryOnlyBody);
		expect(readFileSync(join(worktree, planFolderPath, 'plan.md'), 'utf8')).toBe(gradedPlanBody);
		expect(nothingToSave).toBeUndefined();
		expect(readdirSync(untouchedPrimary)).toStrictEqual([]);
		expect(existsSync(join(untouchedPrimary, planFolderPath))).toBe(false);
	});

	test('answers one sentence when the plan folder cannot be saved, rather than throwing', async () => {
		const { worktree, primary } = await setupUnwritablePrimary();

		const result = await copyPlanFolderToPrimary({ worktree, primary, name: planName });

		expect(result).toEqual({ error: expect.stringContaining(primary) });
		expect(readFileSync(join(worktree, planFolderPath, 'plan.md'), 'utf8')).toBe(gradedPlanBody);
	});
});
