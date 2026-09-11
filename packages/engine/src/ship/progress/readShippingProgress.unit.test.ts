import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { ShippingProgress } from '#src/contracts/index.ts';
import { RunStatus, ShippingStepId } from '#src/contracts/index.ts';
import { readShippingProgress } from '#src/ship/progress/index.ts';

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

/** A checkout whose ship progress folder holds one record per branch: not JSON, off-contract, or valid. */
const setupProgressRecords = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-shipping-progress-'));
	const progressDir = join(cwd, '.lightsout', 'ship', 'progress');
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

	mkdirSync(progressDir, { recursive: true });

	for (const [branch, body] of Object.entries(bodies)) {
		writeFileSync(join(progressDir, `${branch}.json`), body, 'utf8');
	}

	return { cwd, progressDir, branches: Object.keys(bodies) };
};

/** A checkout where a folder stands at `lo-7-folder`'s record path, so the read fails with something other than a missing file. */
const setupFolderAtRecordPath = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-shipping-progress-'));
	const recordPath = join(cwd, '.lightsout', 'ship', 'progress', 'lo-7-folder.json');

	mkdirSync(recordPath, { recursive: true });

	return { cwd, recordPath };
};

describe('readShippingProgress', () => {
	test('a branch with no record reads as absent, with the path it would be filed at', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-shipping-progress-'));

		const reading = await readShippingProgress({ cwd, branch: 'feature/lo-7' });

		expect(reading).toStrictEqual({
			path: join(cwd, '.lightsout', 'ship', 'progress', 'feature-lo-7.json'),
			exists: false,
			progress: undefined,
		});
	});

	test('tells an unreadable or off-contract record from a valid one', async () => {
		const { cwd, progressDir, branches } = setupProgressRecords();

		const readings = await Promise.all(branches.map((branch) => readShippingProgress({ cwd, branch })));

		expect(readings).toStrictEqual([
			{ path: join(progressDir, 'lo-7-unparseable.json'), exists: true, progress: undefined },
			{ path: join(progressDir, 'lo-7-no-steps.json'), exists: true, progress: undefined },
			{ path: join(progressDir, 'lo-7-valid.json'), exists: true, progress: validRecord },
		]);
	});

	test('a record path taken by a folder reads as unreadable, not as missing', async () => {
		const { cwd, recordPath } = setupFolderAtRecordPath();

		const reading = await readShippingProgress({ cwd, branch: 'lo-7-folder' });

		expect(reading).toStrictEqual({ path: recordPath, exists: true, progress: undefined });
	});
});
