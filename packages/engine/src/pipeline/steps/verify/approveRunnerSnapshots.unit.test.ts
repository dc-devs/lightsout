import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { ApprovedTestRecord, RunManifest } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { approveRunnerSnapshots } from '#src/pipeline/steps/verify/approveRunnerSnapshots.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const runId = 'run-snapshots-1';

/** A snapshot the repo already carries at `HEAD` — committed with the fixture. */
const committedSnapshot = 'src/__snapshots__/widget.unit.test.ts.snap';

/** A snapshot no commit carries, written into the tree after the fixture's commit. */
const freshSnapshot = 'src/__snapshots__/gadget.unit.test.ts.snap';

const hashOf = ({ content }: { content: string }) => createHash('sha256').update(content).digest('hex');

/** Where the run keeps the approved copy of one test-side file. Spelled out rather than imported, so the test states the path the run promises. */
const approvedCopy = ({ cwd, path }: { cwd: string; path: string }) => join(cwd, '.lightsout', 'runs', runId, 'approved', path);

interface SetupParams {
	/** Repo-relative path to content, written into the tree after the commit — what a gate run leaves behind. */
	written?: Record<string, string>;
	/** What the manifest already records as approved. */
	approvedTests?: ApprovedTestRecord[];
	/** What the manifest reports the run has changed so far. */
	changedFiles?: string[];
}

/**
 * A real git repo carrying one committed snapshot, plus whatever the gate run
 * is said to have written since, and a `PipelineRun` stub whose manifest the
 * approval's patches are folded into.
 */
const setupSnapshotRun = ({ written = {}, approvedTests = [], changedFiles = [] }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({
		sources: { 'src/index.js': 'export const one = 1;\n', [committedSnapshot]: 'exports[`widget renders 1`] = `<widget />`;\n' },
	});

	for (const [path, content] of Object.entries(written)) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), content);
	}

	const manifest = { runId, changedFiles, approvedTests } as unknown as RunManifest;
	const progress: string[] = [];

	const run = {
		cwd,
		current: () => manifest,
		progress: (message: string) => progress.push(message),
		update: async ({ patch }: { patch: Partial<RunManifest> }) => {
			Object.assign(manifest, patch);
		},
	} as unknown as PipelineRun;

	return { cwd, manifest, run };
};

test("approveRunnerSnapshots: a snapshot the gate run wrote is approved as the runner's, and an unchanged one is left alone", async () => {
	const runnerWrote = 'exports[`gadget renders 1`] = `<gadget />`;\n';
	const { cwd, manifest, run } = setupSnapshotRun({ written: { [freshSnapshot]: runnerWrote }, changedFiles: [committedSnapshot] });

	const approved = await approveRunnerSnapshots({ run });

	// jest writes a brand-new snapshot itself during the gate run, with no agent
	// behind the edit — approving it here is what keeps the next checkpoint from
	// bundling the runner's own output as somebody's change to a test. A
	// snapshot HEAD already carries is not the runner's first write, so it is
	// left for the review to judge like any other edit.
	expect(approved).toBe(1);
	expect(readFileSync(approvedCopy({ cwd, path: freshSnapshot }), 'utf8')).toBe(runnerWrote);
	expect(existsSync(approvedCopy({ cwd, path: committedSnapshot }))).toBe(false);
	expect(manifest.approvedTests).toStrictEqual([{ path: freshSnapshot, sha256: hashOf({ content: runnerWrote }), removed: false }]);
});

test('approveRunnerSnapshots: a snapshot recreated over an approved removal is left unapproved for review', async () => {
	const removal: ApprovedTestRecord = { path: freshSnapshot, removed: true };
	const { cwd, manifest, run } = setupSnapshotRun({
		written: { [freshSnapshot]: 'exports[`gadget renders 1`] = `<gadget />`;\n' },
		approvedTests: [removal],
	});

	const approved = await approveRunnerSnapshots({ run });

	// jest treats a deleted snapshot as brand new and writes it green, so a file
	// back on disk over an approved removal is the consequence of an agent's
	// deletion rather than the runner's own work. It stays unapproved, so the
	// next checkpoint bundles it as an addition and the reviewer rules on it.
	expect(approved).toBe(0);
	expect(existsSync(approvedCopy({ cwd, path: freshSnapshot }))).toBe(false);
	expect(manifest.approvedTests).toStrictEqual([removal]);
});
