import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { removeShippedRunWorkspace } from '#src/cli/common/implementRun/removeShippedRunWorkspace.ts';
import { RunManifest, WorktreeOwner } from '#src/contracts/index.ts';
import { createWorktree, deleteWorktreeRecord, readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/index.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

const at = '2026-01-01T00:00:00.000Z';

/** The manifest of a run that has just shipped, recording the branch and the workspace its worktree cleanup is decided from. */
const manifestFor = ({ branch, workspace }: { branch: string; workspace?: string }): RunManifest =>
	RunManifest.parse({
		runId: 'run-shipped',
		createdAt: at,
		updatedAt: at,
		plan: '.lightsout/plans/demo/plan.md',
		harness: 'claude-code',
		status: 'passed',
		currentStep: null,
		steps: [],
		changedFiles: [],
		branch,
		workspace,
	});

/**
 * A primary checkout with one real worktree on a ticket branch, and the shipped
 * run's records planted in the checkout the command was launched from.
 *
 * Real git rather than a stubbed one, for the reason
 * `settleReconciledWorktree.unit.test.ts` gives: whether a tree came down is
 * git's answer, and a stub would only repeat the test's own assumption back.
 */
const setupShippedRun = async ({ branch, owner }: { branch: string; owner: WorktreeOwner }) => {
	const { cwd } = setupBranchRepo();
	const created = await createWorktree({ cwd, branch, defaultBranch: 'main', owner, reuseExisting: false });
	const worktreePath = String(created);
	const runDir = await seedRunDir({ cwd, manifest: { runId: 'run-shipped', branch, workspace: worktreePath } });

	return { cwd, worktreePath, runDir };
};

/** A directory that is not a worktree at all, so git refuses to remove it. */
const setupUnremovableTree = async ({ branch }: { branch: string }) => {
	const { cwd } = setupBranchRepo();
	const standing = mkdtempSync(join(tmpdir(), 'lightsout-not-a-worktree-'));

	await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Implement, worktreePath: standing });

	return { cwd, standing };
};

describe('removeShippedRunWorkspace', () => {
	test("a merged standalone worktree comes down and its record with it, leaving the run's records untouched", async () => {
		const { cwd, worktreePath, runDir } = await setupShippedRun({ branch: 'lo-70-implement', owner: WorktreeOwner.Implement });

		// Handed the workspace rather than the launching checkout — the way the
		// ship tail calls it — so the primary checkout must be resolved here.
		await removeShippedRunWorkspace({ cwd: worktreePath, manifest: manifestFor({ branch: 'lo-70-implement', workspace: worktreePath }) });

		expect(existsSync(worktreePath)).toBe(false);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-70-implement' })).toBeUndefined();
		expect(existsSync(join(runDir, 'manifest.json'))).toBe(true);
	});

	test('a queue-owned tree is left exactly where it is', async () => {
		const { cwd, worktreePath } = await setupShippedRun({ branch: 'lo-70-drain', owner: WorktreeOwner.Queue });

		await removeShippedRunWorkspace({ cwd, manifest: manifestFor({ branch: 'lo-70-drain', workspace: worktreePath }) });

		expect(existsSync(worktreePath)).toBe(true);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ owner: 'queue', worktreePath }));
	});

	test('an unrecorded tree and an explicitly selected checkout are never removed', async () => {
		const unrecorded = await setupShippedRun({ branch: 'lo-70-unrecorded', owner: WorktreeOwner.Implement });
		const selected = await setupShippedRun({ branch: 'lo-70-selected', owner: WorktreeOwner.Implement });

		// A run started with --no-worktree records no workspace at all.
		await removeShippedRunWorkspace({ cwd: unrecorded.cwd, manifest: manifestFor({ branch: 'lo-70-unrecorded' }) });
		// A tree nothing claims: every tree made before ownership was recorded.
		await deleteWorktreeRecord({ cwd: selected.cwd, branch: 'lo-70-selected' });
		await removeShippedRunWorkspace({ cwd: selected.cwd, manifest: manifestFor({ branch: 'lo-70-selected', workspace: selected.worktreePath }) });

		expect(existsSync(unrecorded.worktreePath)).toBe(true);
		expect(existsSync(selected.worktreePath)).toBe(true);
		expect(await readWorktreeRecord({ cwd: unrecorded.cwd, branch: 'lo-70-unrecorded' })).toEqual(expect.objectContaining({ owner: 'implement' }));
	});

	test('a record pointing somewhere else never licenses removing this workspace', async () => {
		const { cwd, worktreePath } = await setupShippedRun({ branch: 'lo-70-reused', owner: WorktreeOwner.Implement });
		const elsewhere = mkdtempSync(join(tmpdir(), 'lightsout-elsewhere-'));

		await removeShippedRunWorkspace({ cwd, manifest: manifestFor({ branch: 'lo-70-reused', workspace: elsewhere }) });

		expect(existsSync(elsewhere)).toBe(true);
		expect(existsSync(worktreePath)).toBe(true);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-70-reused' })).toEqual(expect.objectContaining({ owner: 'implement', worktreePath }));
	});

	test('a cleanup that fails never turns a shipped run into a failed one, and keeps the record', async () => {
		const { cwd, standing } = await setupUnremovableTree({ branch: 'lo-70-stuck' });

		// A throw would land here as the error itself, so the assertion below pins
		// both halves: nothing was thrown, and the helper answered nothing.
		const settled = await removeShippedRunWorkspace({ cwd, manifest: manifestFor({ branch: 'lo-70-stuck', workspace: standing }) }).catch(
			(thrown: unknown) => thrown,
		);

		expect(settled).toBeUndefined();
		expect(existsSync(standing)).toBe(true);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-70-stuck' })).toEqual(expect.objectContaining({ owner: 'implement', worktreePath: standing }));
	});
});
