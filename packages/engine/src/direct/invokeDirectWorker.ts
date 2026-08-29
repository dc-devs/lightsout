import { buildDirectWorkerInvocation } from '#src/agents/index.ts';
import type { RunState } from '#src/common/services/RunState.ts';
import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';
import { RunStatus, WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { nextStepRecord } from '#src/direct/common/utils/nextStepRecord.ts';
import { stopDirectRun } from '#src/direct/common/utils/stopDirectRun.ts';
import type { Driver } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';

/** The step every direct-worker invocation is recorded under. */
const implementStep = 'implement';

interface Params {
	run: RunState;
	driver: Driver;
	ticketRef: string;
	ticketBody: string;
	standards?: string;
	/** The answer to the question a previous invocation stopped on. */
	answeredQuestion?: AnsweredQuestion;
	/** Gate output from a failed attempt, handed back for a fix re-invocation. */
	errorContext?: string;
}

/**
 * One direct-worker invocation, recorded as an attempt of the implement step.
 *
 * A rate-limited harness parks the run, an ambiguous ticket escalates carrying
 * the question — which is exactly what the queue's relay loop reads — and any
 * other refusal fails it.
 */
export const invokeDirectWorker = async ({
	run,
	driver,
	ticketRef,
	ticketBody,
	standards,
	answeredQuestion,
	errorContext,
}: Params): Promise<PipelineResult | undefined> => {
	const record = nextStepRecord({ run, id: implementStep });

	await run.setStep({ record });
	run.progress(`${implementStep} — building ${ticketRef} from the ticket body`);

	const outcome = await invokeAgentWithContract({
		driver,
		cwd: run.cwd,
		invocation: buildDirectWorkerInvocation({
			ticketRef,
			ticketBody,
			standards,
			allowedCommands: run.config['agent-commands'],
			errorContext,
			changedFiles: run.current().changedFiles,
			answeredQuestion,
		}),
		contract: WorkReport,
		model: run.config.model,
		effort: run.config.effort,
		permissions: run.config.permissions,
		timeoutMs: run.agentTimeoutMs,
		allowedCommands: run.config['agent-commands'],
	});

	await run.recordUsage({ step: implementStep, usage: outcome.usage });

	if (!outcome.ok) {
		const status = outcome.rateLimited ? RunStatus.PausedRateLimit : RunStatus.Failed;

		return stopDirectRun({ run, record, status, error: outcome.failure });
	}

	const report: WorkReport = outcome.report;
	const refusal = report.failures[0] ?? report.summary;

	if (report.status === WorkReportStatus.TerminatedAmbiguity) {
		// The first failure IS the question — the relay puts it to the one
		// terminal and re-invokes with the answer.
		return stopDirectRun({ run, record, status: RunStatus.Escalated, error: refusal });
	}

	if (report.status !== WorkReportStatus.Complete) {
		return stopDirectRun({ run, record, status: RunStatus.Failed, error: refusal });
	}

	const changedFiles = [...new Set([...run.current().changedFiles, ...report.changedFiles.map((file) => file.path)])];

	await run.setStep({ record: { ...record, status: RunStatus.Passed, report, changedFiles }, patch: { changedFiles } });

	return undefined;
};
