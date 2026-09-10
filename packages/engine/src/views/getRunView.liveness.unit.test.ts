import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { RunStatus } from '#src/contracts/index.ts';
import { getRunView } from '#src/views/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/**
 * A holder written into one checkout's own `.lightsout/lock.json`. The run lock
 * is per-checkout, which is exactly what lets an isolated run's workspace and
 * the checkout it was launched from each hold a different one.
 */
const plantLock = async ({ dir, runId }: { dir: string; runId: string }) => {
	await mkdir(join(dir, '.lightsout'), { recursive: true });
	await writeFile(join(dir, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId, startedAt: '2026-01-01T00:00:00.000Z' }), 'utf8');
};

interface SetupParams {
	/** The run named by the workspace checkout's lock, planted before any removal. */
	workspaceHolder?: string;
	/** The run named by the lock of the checkout the view is read from. */
	launchingHolder?: string;
	/** Leave the manifest's `workspace` field off, as a run built in the checkout it was launched from does. */
	recordWorkspace?: boolean;
	/** Delete the workspace directory after recording it, as a post-ship cleanup does. */
	removeWorkspace?: boolean;
}

/** A running run whose records are in one checkout and whose work happened in another. */
const setupIsolatedRun = async ({ workspaceHolder, launchingHolder, recordWorkspace = true, removeWorkspace = false }: SetupParams = {}) => {
	const cwd = await freshCwd();
	const workspaceDir = await freshCwd();

	if (workspaceHolder !== undefined) {
		await plantLock({ dir: workspaceDir, runId: workspaceHolder });
	}

	if (launchingHolder !== undefined) {
		await plantLock({ dir: cwd, runId: launchingHolder });
	}

	if (removeWorkspace) {
		await rm(workspaceDir, { recursive: true, force: true });
	}

	await seedRunDir({
		cwd,
		manifest: { runId: 'run-isolated', status: RunStatus.Running, workspace: recordWorkspace ? workspaceDir : undefined },
	});

	return { cwd };
};

describe('getRunView', () => {
	test('an isolated run is live when its own workspace holds the lock, though the checkout the view is read from holds none', async () => {
		const { cwd } = await setupIsolatedRun({ workspaceHolder: 'run-isolated' });

		const view = await getRunView({ cwd, runId: 'run-isolated' });

		// the run's process took its lock where it works, and the detail page finds
		// it there — a healthy run, not a crash leftover waiting to be resumed
		expect(view.listing).toEqual(expect.objectContaining({ runId: 'run-isolated', live: true, resumable: false }));
	});

	test('the holder of the checkout the view is read from never decides an isolated run', async () => {
		const { cwd } = await setupIsolatedRun({ workspaceHolder: 'run-somebody-else', launchingHolder: 'run-isolated' });

		const view = await getRunView({ cwd, runId: 'run-isolated' });

		// the launching checkout names this run, so reading the lock there would
		// call a dead run live; only the workspace's own holder counts
		expect(view.listing).toEqual(expect.objectContaining({ live: false, resumable: true }));
	});

	test.each([
		{ scenario: 'a run that recorded no workspace at all', recordWorkspace: false, removeWorkspace: false },
		{ scenario: 'a run whose recorded workspace has been removed', recordWorkspace: true, removeWorkspace: true },
	])('$scenario is judged by the checkout the view is read from', async ({ recordWorkspace, removeWorkspace }) => {
		const { cwd } = await setupIsolatedRun({ launchingHolder: 'run-isolated', recordWorkspace, removeWorkspace });

		const view = await getRunView({ cwd, runId: 'run-isolated' });

		// a run built in the checkout it was launched from, and one whose tree has
		// been cleaned up, both still report the holder standing behind them
		expect(view.listing).toEqual(expect.objectContaining({ live: true, resumable: false }));
	});
});
