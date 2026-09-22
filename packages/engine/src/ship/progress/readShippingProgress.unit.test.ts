import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { ShippingProgress } from '#src/contracts/index.ts';
import { RunStatus, ShippingStepId } from '#src/contracts/index.ts';
import { readShippingProgress } from '#src/ship/progress/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

const validRecord: ShippingProgress = {
	branch: 'lo-7-valid',
	attempt: 1,
	maxAttempts: 3,
	pid: 4242,
	startedAt: '2026-09-10T10:00:00.000Z',
	updatedAt: '2026-09-10T10:02:00.000Z',
	lastProgress: 'ship: waiting for checks',
	steps: [
		{ id: ShippingStepId.Integrate, status: RunStatus.Passed, startedAt: '2026-09-10T10:00:00.000Z', durationMs: 30_000 },
		{ id: ShippingStepId.Push, status: RunStatus.Passed, startedAt: '2026-09-10T10:00:30.000Z', durationMs: 10_000 },
		{ id: ShippingStepId.PullRequest, status: RunStatus.Passed, startedAt: '2026-09-10T10:00:40.000Z', durationMs: 5_000 },
		{ id: ShippingStepId.Checks, status: RunStatus.Running, startedAt: '2026-09-10T10:00:45.000Z' },
		{ id: ShippingStepId.Merge, status: RunStatus.Pending },
		{ id: ShippingStepId.Sync, status: RunStatus.Pending },
	],
};

/** A checkout whose ticket folders hold one record per branch: not JSON, off-contract, or valid. */
const setupProgressRecords = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-shipping-progress-'));
	const workOrdersDir = join(cwd, '.lightsout', 'work-orders');
	const bodies: Record<string, string> = {
		'lo-7-unparseable': 'not json at all',
		'lo-7-no-steps': JSON.stringify({
			branch: 'lo-7-no-steps',
			attempt: 1,
			maxAttempts: 3,
			pid: 4242,
			startedAt: '2026-09-10T10:00:00.000Z',
			updatedAt: '2026-09-10T10:00:00.000Z',
		}),
		'lo-7-valid': JSON.stringify(validRecord),
	};

	for (const [branch, body] of Object.entries(bodies)) {
		mkdirSync(join(workOrdersDir, branch), { recursive: true });
		writeFileSync(join(workOrdersDir, branch, 'ship-progress.json'), body, 'utf8');
	}

	return { cwd, workOrdersDir, branches: Object.keys(bodies) };
};

/** A checkout where a folder stands at `lo-7-folder`'s record path, so the read fails with something other than a missing file. */
const setupFolderAtRecordPath = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-shipping-progress-'));
	const recordPath = join(cwd, '.lightsout', 'work-orders', 'lo-7-folder', 'ship-progress.json');

	mkdirSync(recordPath, { recursive: true });

	return { cwd, recordPath };
};

/**
 * A primary checkout that shipped a branch, with a linked worktree cut from it
 * standing on that branch — the shape where the record's folder and the
 * caller's `cwd` are two different checkouts.
 */
const setupRecordInPrimary = () => {
	const branch = 'lo-7-shipped-in-primary';
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', branch);
	const ticketDir = join(realpathSync(cwd), '.lightsout', 'work-orders', branch);
	const progress: ShippingProgress = { ...validRecord, branch };

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd, stdio: 'ignore' });
	mkdirSync(ticketDir, { recursive: true });
	writeFileSync(join(ticketDir, 'ship-progress.json'), JSON.stringify(progress), 'utf8');

	return { branch, ticketDir, worktree, progress };
};

describe('readShippingProgress', () => {
	test('a branch with no record reads as absent, with the path it would be filed at', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-shipping-progress-'));

		const reading = await readShippingProgress({ cwd, branch: 'feature/lo-7' });

		expect(reading).toStrictEqual({
			path: join(cwd, '.lightsout', 'work-orders', 'feature-lo-7', 'ship-progress.json'),
			exists: false,
			progress: undefined,
		});
	});

	test('tells an unreadable or off-contract record from a valid one', async () => {
		const { cwd, workOrdersDir, branches } = setupProgressRecords();

		const readings = await Promise.all(branches.map((branch) => readShippingProgress({ cwd, branch })));

		expect(readings).toStrictEqual([
			{ path: join(workOrdersDir, 'lo-7-unparseable', 'ship-progress.json'), exists: true, progress: undefined },
			{ path: join(workOrdersDir, 'lo-7-no-steps', 'ship-progress.json'), exists: true, progress: undefined },
			{ path: join(workOrdersDir, 'lo-7-valid', 'ship-progress.json'), exists: true, progress: validRecord },
		]);
	});

	test('a record path taken by a folder reads as unreadable, not as missing', async () => {
		const { cwd, recordPath } = setupFolderAtRecordPath();

		const reading = await readShippingProgress({ cwd, branch: 'lo-7-folder' });

		expect(reading).toStrictEqual({ path: recordPath, exists: true, progress: undefined });
	});

	test("readShippingProgress: finds the primary checkout's record when asked from a linked worktree", async () => {
		const { branch, ticketDir, worktree, progress } = setupRecordInPrimary();

		const reading = await readShippingProgress({ cwd: worktree, branch });

		expect(reading).toStrictEqual({ path: join(ticketDir, 'ship-progress.json'), exists: true, progress });
	});
});
