import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { readRunProcessLock } from '#src/runState/lock/index.ts';

const startedAt = '2026-07-03T00:00:00.000Z';

const manifest = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId: 'run-isolated',
	createdAt: '2026-07-03T00:00:00.000Z',
	updatedAt: '2026-07-03T00:01:00.000Z',
	plan: 'plans/demo/plan.md',
	harness: 'claude-code',
	status: RunStatus.Running,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	acceptanceTests: [],
	approvedTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
	...overrides,
});

interface SetupParams {
	/** The holder planted in the checkout the reader was launched from. */
	launching?: { pid: number; runId: string };
	/** The holder planted in the run's own workspace checkout. */
	workspace?: { pid: number; runId: string };
	/** Leave a plain file at the recorded workspace path instead of a checkout. */
	workspaceIsFile?: boolean;
}

/**
 * Two real checkouts on disk, each free to hold its own lock — which is the
 * whole point: the run lock is per-checkout, so an isolated run takes its lock
 * in the workspace while its manifest is read where the command was launched.
 */
const setupCheckouts = async ({ launching, workspace, workspaceIsFile }: SetupParams = {}) => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-launching-'));
	const workspaceDir = await mkdtemp(join(tmpdir(), 'lightsout-workspace-'));

	for (const [dir, holder] of [
		[cwd, launching],
		[workspaceDir, workspace],
	] as const) {
		if (holder) {
			await mkdir(join(dir, '.lightsout'), { recursive: true });
			await writeFile(join(dir, '.lightsout', 'lock.json'), JSON.stringify({ ...holder, startedAt }), 'utf8');
		}
	}

	if (workspaceIsFile) {
		await rm(workspaceDir, { recursive: true, force: true });
		await writeFile(workspaceDir, 'not a checkout', 'utf8');
	}

	return { cwd, workspaceDir };
};

describe('readRunProcessLock', () => {
	test("a run's holder is read from its recorded workspace, not from the checkout the reader is standing in", async () => {
		const { cwd, workspaceDir } = await setupCheckouts({
			launching: { pid: 111, runId: 'run-standing-here' },
			workspace: { pid: 222, runId: 'run-isolated' },
		});

		const holder = await readRunProcessLock({ cwd, manifest: manifest({ workspace: workspaceDir }) });

		// the launching checkout's own holder is a different run entirely — reading
		// it would brand this healthy run a crash leftover
		expect(holder).toStrictEqual({ pid: 222, runId: 'run-isolated', startedAt });
	});

	test('an absent or removed workspace falls back to the launching checkout instead of failing', async () => {
		const { cwd, workspaceDir } = await setupCheckouts({ launching: { pid: 333, runId: 'run-isolated' } });
		await rm(workspaceDir, { recursive: true, force: true });

		const forNoWorkspace = await readRunProcessLock({ cwd, manifest: manifest() });
		const forRemovedWorkspace = await readRunProcessLock({ cwd, manifest: manifest({ workspace: workspaceDir }) });

		// a reader asking who holds a run is never the place to report a missing
		// directory — a run written before isolation existed, and one whose tree
		// has been cleaned up, both still have a holder to name
		expect({ forNoWorkspace, forRemovedWorkspace }).toStrictEqual({
			forNoWorkspace: { pid: 333, runId: 'run-isolated', startedAt },
			forRemovedWorkspace: { pid: 333, runId: 'run-isolated', startedAt },
		});
	});

	test('a recorded workspace that is a file names the launching checkout as the holder rather than failing', async () => {
		const { cwd, workspaceDir } = await setupCheckouts({
			launching: { pid: 444, runId: 'run-isolated' },
			workspaceIsFile: true,
		});

		const holder = await readRunProcessLock({ cwd, manifest: manifest({ workspace: workspaceDir }) });

		// a path that answers stat but is no checkout holds no lock of its own —
		// refusing the run a holder here is the crash-leftover misreport this
		// reader exists to prevent, so the launching checkout answers instead
		expect(holder).toStrictEqual({ pid: 444, runId: 'run-isolated', startedAt });
	});
});
