import { buildRunCommitMessage } from '#src/commit/buildRunCommitMessage.ts';
import { commitTicketWork } from '#src/commit/commitTicketWork.ts';
import { describeUnownedEdits } from '#src/commit/common/utils/describeUnownedEdits.ts';
import { readRunCommitSubject } from '#src/commit/common/utils/readRunCommitSubject.ts';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { isGeneratedPath } from '#src/common/sourceFiles/isGeneratedPath.ts';
import type { LightsoutConfig, RunManifest } from '#src/contracts/index.ts';
import { getRunDir } from '#src/runState/index.ts';

/**
 * The slice of a run this step touches, structural on purpose: the implement
 * pipeline's `PipelineRun` and the direct pipeline's `RunState` share no
 * declared type, and the commit needs nothing of either beyond these five.
 */
interface CommittingRun {
	cwd: string;
	config: LightsoutConfig;
	current(): RunManifest;
	progress(message: string): void;
	update({ patch }: { patch: Partial<RunManifest> }): Promise<void>;
}

interface Params {
	run: CommittingRun;
	/** The subject a pipeline that builds no plan supplies for itself — the direct pipeline's ticket heading. Omitted by a plan run, whose subject is read from the plan the manifest names. */
	subject?: string;
	/** Whether this run continues work that was parked — it adopted an existing manifest, or its caller knows the sequence it belongs to was resumed. Only such a run's tree is compared for edits the run does not own. */
	resumed: boolean;
}

/**
 * Commit one unit of work that passed its own gates, before the run is stamped
 * passed — which is what lets a nine-hour sequence that dies in hour eight keep
 * the eight verified hours.
 *
 * Both pipelines end here, so there is one commit behaviour rather than one per
 * command. The changed-file list the manifest already carries is what tells a
 * unit that genuinely changed nothing from one whose work an earlier attempt
 * already committed: nothing to commit with an empty list is a silent agent and
 * fails the run, while nothing to commit with a list means this unit's commit
 * already landed and the run passes without committing twice. That list is read
 * through the `generated` prefixes, because the direct pipeline records the
 * worker's own report unfiltered — a worker that touched only build output
 * would otherwise pass with nothing on the branch to ship.
 *
 * @returns undefined when the work is in history, or the one sentence saying why it is not
 */
export const commitRunWork = async ({ run, subject, resumed }: Params): Promise<string | undefined> => {
	const manifest = run.current();
	const generated = run.config.generated ?? [];
	const changed = manifest.changedFiles.filter((path) => !isGeneratedPath({ path, generated }));
	// Before `commitTicketWork`, never after: that function stages with
	// `git add -A`, so a refusal decided afterwards would be decided about a tree
	// already staged.
	const unowned = resumed ? await describeUnownedEdits({ cwd: run.cwd, manifest, generated }) : undefined;

	if (unowned !== undefined) {
		return unowned;
	}

	const line = subject ?? (await readRunCommitSubject({ cwd: run.cwd, manifest, config: run.config, onProgress: (message) => run.progress(message) }));
	const committed = await commitTicketWork({
		cwd: run.cwd,
		message: buildRunCommitMessage({ subject: line, runId: manifest.runId }),
		runDir: getRunDir({ cwd: run.cwd, runId: manifest.runId }),
		generated,
		onProgress: (message) => run.progress(message),
	});

	if ('error' in committed) {
		return committed.error;
	}

	if (!committed.committed) {
		if (changed.length === 0) {
			return 'the worker changed nothing';
		}

		run.progress('nothing left to commit — this unit’s work is already in the branch’s history');

		return undefined;
	}

	const sha = await readGitHeadCommit({ cwd: run.cwd });

	// Never passed over: the result block reads the recorded commits, so a run
	// that recorded none would announce work it just committed as already in
	// history. Failing costs one re-entry, which then finds a clean tree with
	// changed files recorded and passes.
	if (sha === undefined) {
		return `the work in ${run.cwd} was committed but git could not name the commit — resume the run so the tree is checked again`;
	}

	await run.update({ patch: { commits: [...manifest.commits, { sha, subject: line, runId: manifest.runId }] } });
	run.progress(`committed ${sha.slice(0, 7)} — ${line}`);

	return undefined;
};
