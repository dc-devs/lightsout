import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { isSnapshotFile } from '#src/common/sourceFiles/isSnapshotFile.ts';
import { approveTestFiles, readApprovedTest } from '#src/pipeline/approvedTests/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
}

/**
 * Approve every snapshot file the gate run itself wrote, so the runner's own
 * output is never bundled at the next checkpoint as somebody's edit to a test.
 *
 * Jest writes a brand-new `.snap` file the first time a case calls
 * `toMatchSnapshot`, during the gate run and with no agent behind it. Only that
 * first write is approved here — a path with no approved record and nothing at
 * `HEAD`. A snapshot recreated over an approved removal is left alone, because
 * jest treats a deleted snapshot as brand new and writes it green: that file is
 * the consequence of an agent's deletion, and it enters the next checkpoint's
 * bundle as an addition for the reviewer to rule on. A snapshot `HEAD` already
 * carries and now differs never reaches here either — jest fails a mismatching
 * snapshot rather than rewriting it, so a changed one is an agent's edit the
 * pre-gate review already saw.
 *
 * @returns how many were approved.
 */
export const approveRunnerSnapshots = async ({ run }: Params): Promise<number> => {
	const manifest = run.current();
	const seen = [...((await readGitChangedFiles({ cwd: run.cwd })) ?? []), ...manifest.changedFiles];
	const snapshots = [...new Set(seen)].filter((path) => isSnapshotFile({ path }) && !manifest.approvedTests.some((record) => record.path === path));
	const written: string[] = [];

	for (const path of snapshots) {
		if ((await readApprovedTest({ run, path })) === undefined) {
			written.push(path);
		}
	}

	if (written.length === 0) {
		return 0;
	}

	await run.update({ patch: { approvedTests: await approveTestFiles({ run, paths: written }) } });
	run.progress(`${manifest.currentStep ?? 'verify'}: ${written.length} snapshot file(s) the gate run wrote were approved as the runner's own output`);

	return written.length;
};
