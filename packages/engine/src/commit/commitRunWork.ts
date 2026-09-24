import { commitWorkOrderWork } from '#src/commit/commitWorkOrderWork.ts';
import type { CommitAddress } from '#src/commit/common/types/CommitAddress.ts';
import { describeUnownedEdits } from '#src/commit/common/utils/describeUnownedEdits.ts';
import { readRunCommitAddress } from '#src/commit/common/utils/readRunCommitAddress.ts';
import { composeCommitMessage } from '#src/commit/composeCommitMessage.ts';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { isGeneratedPath } from '#src/common/sourceFiles/isGeneratedPath.ts';
import type { AgentUsage, LightsoutConfig, RunManifest } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { resolveRunDir } from '#src/runState/index.ts';

/**
 * The slice of a run this step touches, structural on purpose: the implement
 * pipeline's `PipelineRun` and the direct pipeline's `RunState` share no
 * declared type, and the commit needs nothing of either beyond these six.
 */
interface CommittingRun {
	cwd: string;
	config: LightsoutConfig;
	current(): RunManifest;
	progress(message: string): void;
	update({ patch }: { patch: Partial<RunManifest> }): Promise<void>;
	/** Bills the commit-message agent call to the run. */
	recordUsage({ step, usage }: { step: string; usage?: AgentUsage }): Promise<void>;
}

interface Params {
	run: CommittingRun;
	/** The harness the pipeline already holds — the commit-message agent runs on it. */
	driver: Driver;
	/** The address a pipeline that builds no plan supplies for itself — the direct run's. Omitted by a plan run, whose address is read from the plan the manifest names. */
	address?: CommitAddress;
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
export const commitRunWork = async ({ run, driver, address, resumed }: Params): Promise<string | undefined> => {
	const manifest = run.current();
	const generated = run.config.generated ?? [];
	const changed = manifest.changedFiles.filter((path) => !isGeneratedPath({ path, generated }));
	// Before `commitWorkOrderWork`, never after: that function stages with
	// `git add -A`, so a refusal decided afterwards would be decided about a tree
	// already staged.
	const unowned = resumed ? await describeUnownedEdits({ cwd: run.cwd, manifest, generated }) : undefined;

	if (unowned !== undefined) {
		return unowned;
	}

	// Resolved rather than spelled, because a run's folder is filed under the
	// ticket it belongs to. A checkout that cannot be read answers no run at all,
	// which is a refusal to commit rather than a crash: the caller gets the same
	// sentence it would get from any other unreadable tree.
	let runDir: string;

	try {
		runDir = await resolveRunDir({ cwd: run.cwd, runId: manifest.runId });
	} catch {
		return `${run.cwd} could not be read, so this run's records could not be found — nothing was committed`;
	}

	const onProgress = (message: string) => run.progress(message);
	const resolved = address ?? (await readRunCommitAddress({ cwd: run.cwd, manifest, config: run.config, onProgress }));
	const committed = await commitWorkOrderWork({
		cwd: run.cwd,
		composeMessage: ({ cwd }) =>
			composeCommitMessage({
				cwd,
				driver,
				config: run.config,
				address: resolved,
				runId: manifest.runId,
				onUsage: ({ usage }) => run.recordUsage({ step: 'commit-message', usage }),
				onProgress,
			}),
		runDir,
		generated,
		onProgress,
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

	// The subject recorded is the one that landed — the agent's, or the template
	// it fell back to — which only the committed message can say.
	const [subject = ''] = committed.message.split('\n');
	const sha = await readGitHeadCommit({ cwd: run.cwd });

	// Never passed over: the result block reads the recorded commits, so a run
	// that recorded none would announce work it just committed as already in
	// history. Failing costs one re-entry, which then finds a clean tree with
	// changed files recorded and passes.
	if (sha === undefined) {
		return `the work in ${run.cwd} was committed but git could not name the commit — resume the run so the tree is checked again`;
	}

	await run.update({ patch: { commits: [...manifest.commits, { sha, subject, runId: manifest.runId }] } });
	run.progress(`committed ${sha.slice(0, 7)} — ${subject}`);

	return undefined;
};
