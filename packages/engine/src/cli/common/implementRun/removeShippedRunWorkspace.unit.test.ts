import { existsSync, mkdtempSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
	const created = await createWorktree({ cwd, branch, startPoint: 'origin/main', owner, reuseExisting: false });
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

/**
 * A shipped `implement`-owned tree holding the only copy of the `demo` plan
 * folder the manifest names — a ticketless plan, with no attachment to fall
 * back on.
 *
 * `blockPrimary` leaves a plain file where the primary checkout's plans
 * directory would go, so the folder cannot be saved there whoever runs the
 * suite; the ownership records sit beside it and stay writable.
 */
const setupShippedPlan = async ({ branch, blockPrimary = false }: { branch: string; blockPrimary?: boolean }) => {
	const shipped = await setupShippedRun({ branch, owner: WorktreeOwner.Implement });
	const planDir = join(shipped.worktreePath, '.lightsout', 'plans', 'demo');
	const progress: string[] = [];

	await mkdir(planDir, { recursive: true });
	await writeFile(join(planDir, 'plan.md'), '# graded plan\n', 'utf8');

	if (blockPrimary) {
		await writeFile(join(shipped.cwd, '.lightsout', 'plans'), 'not a directory\n', 'utf8');
	}

	const onProgress = (message: string) => {
		progress.push(message);
	};

	return { ...shipped, progress, onProgress };
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

	test('saves the plan folder into the primary checkout before the shipped tree comes down', async () => {
		const { cwd, worktreePath } = await setupShippedPlan({ branch: 'lo-131-saved' });

		await removeShippedRunWorkspace({ cwd: worktreePath, manifest: manifestFor({ branch: 'lo-131-saved', workspace: worktreePath }) });

		expect(existsSync(worktreePath)).toBe(false);
		expect(await readFile(join(cwd, '.lightsout', 'plans', 'demo', 'plan.md'), 'utf8')).toBe('# graded plan\n');
	});

	test('leaves the shipped tree standing when the plan folder cannot be saved', async () => {
		const { cwd, worktreePath, progress, onProgress } = await setupShippedPlan({ branch: 'lo-131-unsaved', blockPrimary: true });

		// A throw would land here as the error itself, so the assertion below pins
		// both halves: nothing was thrown, and the helper answered nothing.
		const settled = await removeShippedRunWorkspace({
			cwd: worktreePath,
			manifest: manifestFor({ branch: 'lo-131-unsaved', workspace: worktreePath }),
			onProgress,
		}).catch((thrown: unknown) => thrown);

		expect(settled).toBeUndefined();
		expect(progress).toEqual(expect.arrayContaining([expect.stringContaining(join('.lightsout', 'plans', 'demo'))]));
		expect(existsSync(join(worktreePath, '.lightsout', 'plans', 'demo', 'plan.md'))).toBe(true);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-131-unsaved' })).toEqual(expect.objectContaining({ owner: 'implement', worktreePath }));
	});
});
