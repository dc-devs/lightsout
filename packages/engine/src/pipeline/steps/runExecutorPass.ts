import { buildRefactorExecutorInvocation } from '#src/agents/index.ts';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { RunStatus, type StandardsFinding, type StepRecord, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { collectChanged } from '#src/pipeline/common/utils/collectChanged.ts';
import { invokeRoleOrStop } from '#src/pipeline/common/utils/invokeRoleOrStop.ts';
import { standardsScopeFiles } from '#src/pipeline/common/utils/standardsScopeFiles.ts';
import { withStepFiles } from '#src/pipeline/common/utils/withStepFiles.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { appendFriction } from '#src/runState/index.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	/** Overview text for a phased run — see `buildRefactorExecutorInvocation`. */
	overviewContent?: string;
	standards?: string;
	record: StepRecord;
	/** The blocking work-list this pass hands the executor. */
	findings: StandardsFinding[];
	/** Judgment-carrying findings the executor weighs but is never held on. */
	advisories: StandardsFinding[];
}

/**
 * One refactor-executor invocation and its aftermath.
 *
 * A pass that ended the step outright — a park, a failure, a report that never
 * completed — comes back as `stopped`, already recorded. One that completed
 * hands back the record carrying its changed files, plus the report itself, so
 * the loop can decide whether another pass is worth buying.
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
}: Params): Promise<{ stopped: PipelineResult } | { record: StepRecord; report: WorkReport }> => {
	const outcome = await invokeRoleOrStop({
		run,
		record,
		invocation: buildRefactorExecutorInvocation({
			scope: RefactorScope.Feature,
			planContent,
			overviewContent,
			changedFiles: standardsScopeFiles({ run }),
			standards,
			findings,
			advisories,
		}),
		step: 'refactor',
	});

	if ('stopped' in outcome) {
		return { stopped: outcome.stopped };
	}

	const { report } = outcome;

	await appendFriction({ cwd: run.cwd, runId: run.current().runId, step: 'refactor', friction: report.friction ?? [] });

	if (report.status !== WorkReportStatus.Complete) {
		const status = report.status === WorkReportStatus.Failed ? RunStatus.Failed : RunStatus.Escalated;

		return { stopped: await run.stop({ record: { ...record, report }, status, error: `refactor: ${report.status} — ${report.failures.join('; ')}` }) };
	}

	const next = withStepFiles({ record, reports: [report], gitPrefix });

	await run.setStep({ record: { ...next, report }, patch: await collectChanged({ run, gitPrefix, reports: [report] }) });

	return { record: next, report };
};
