import { buildRefactorExecutorInvocation } from '#src/agents/index.ts';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { buildSelfCheckCommand } from '#src/common/selfCheck/buildSelfCheckCommand.ts';
import { RunStatus, type StandardsFinding, type StepRecord, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { collectChanged } from '#src/pipeline/common/utils/collectChanged.ts';
import { standardsScopeFiles } from '#src/pipeline/common/utils/standardsScopeFiles.ts';
import { withStepFiles } from '#src/pipeline/common/utils/withStepFiles.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { fingerprintScopeFiles } from '#src/pipeline/steps/refactorStep/common/utils/fingerprintScopeFiles.ts';
import { appendFriction } from '#src/runState/index.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	/** Overview text for a phased run — see `buildRefactorExecutorInvocation`. */
	overviewContent?: string;
	standards?: string;
	/** Already carrying the step's cleanup record in its `report` slot — this pass forwards it rather than writing over it. */
	record: StepRecord;
	/** The blocking work-list this round hands the executor. */
	findings: StandardsFinding[];
	/** Judgment-carrying findings the executor weighs but is never held on. */
	advisories: StandardsFinding[];
	/** Fingerprints of the standards-scope files as cleanup began, unchanged across every round. */
	before: Record<string, string>;
}

/** Why this invocation produced no usable work, or `undefined` when it did. */
const failureOf = ({ report, failure }: { report: WorkReport | undefined; failure: string | undefined }) => {
	if (failure !== undefined) {
		return `refactor: ${failure}`;
	}

	return report === undefined || report.status === WorkReportStatus.Complete ? undefined : `refactor: ${report.status} — ${report.failures.join('; ')}`;
};

/** Every scope file whose bytes differ from the step-start fingerprint, or that did not exist then. */
const editedSince = ({ before, after }: { before: Record<string, string>; after: Record<string, string> }) =>
	Object.keys(after).filter((file) => after[file] !== before[file]);

/**
 * One cleanup-executor invocation and its aftermath.
 *
 * A rate limit parks the run and comes back as `parked`, exactly as every other
 * step handles one. Every other unsuccessful outcome — a timeout, an absent or
 * unusable report, a report whose status is not `complete` — comes back as a
 * recorded `failure` instead, because cleanup is best-effort tidying and a
 * broken agent must not stop a run. That is why it calls `run.invokeRole`
 * directly rather than `invokeRoleOrStop`, whose non-rate-limited branch fails
 * the run.
 *
 * The tree is read after every invocation that did not park, in this order:
 * `collectChanged` first, so the manifest's changed-file list — and therefore
 * the standards scope — already holds any file the round created; then the
 * fingerprint diff over that widened scope. Fingerprinting first would leave a
 * new file outside the scope map on both sides, so it would never count as
 * edited. This order is what puts a timed-out attempt's partial edits, and a
 * file a report forgot to mention, into the run's changed-file list anyway.
 */
export const runExecutorPass = async ({
	run,
	gitPrefix,
	planContent,
	overviewContent,
	standards,
	record,
	findings,
	advisories,
	before,
}: Params): Promise<{ parked: PipelineResult } | { record: StepRecord; report?: WorkReport; failure?: string; edited: string[] }> => {
	const outcome = await run.invokeRole({
		invocation: buildRefactorExecutorInvocation({
			scope: RefactorScope.Feature,
			planContent,
			overviewContent,
			changedFiles: standardsScopeFiles({ run }),
			standards,
			findings,
			advisories,
			selfCheckCommand: buildSelfCheckCommand({ cwd: run.cwd, runId: run.current().runId }).command,
		}),
		step: 'refactor',
	});

	if (!outcome.ok && outcome.rateLimited) {
		return { parked: await run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() }) };
	}

	const report = outcome.ok ? outcome.report : undefined;
	const reports = report === undefined ? [] : [report];

	if (report !== undefined) {
		await appendFriction({ cwd: run.cwd, runId: run.current().runId, step: 'refactor', friction: report.friction ?? [] });
	}

	await run.setStep({ record, patch: await collectChanged({ run, gitPrefix, reports }) });

	const edited = editedSince({ before, after: await fingerprintScopeFiles({ run }) });
	const next = withStepFiles({ record: { ...record, changedFiles: [...new Set([...(record.changedFiles ?? []), ...edited])] }, reports, gitPrefix });

	await run.setStep({ record: next });

	return { record: next, report, failure: failureOf({ report, failure: outcome.ok ? undefined : outcome.failure }), edited };
};
