import { consultSupervisor } from '#src/common/utils/consultSupervisor.ts';
import { RunStatus, type StepRecord, SupervisorDecision, WorkReportStatus } from '#src/contracts/index.ts';
import { collectChanged } from '#src/pipeline/common/utils/collectChanged.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import { withStepFiles } from '#src/pipeline/common/utils/withStepFiles.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { appendFriction } from '#src/runState/index.ts';

const maxCheapFixRetries = 2;

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	/** The plan text, for the supervisor's context. */
	planContent: string;
	id: string;
	/** Run the coverage gate in this verify — only once tests for the new code exist. */
	coverage?: boolean;
	buildFix: (errorContext: string) => { systemPrompt: string; prompt: string };
}

/**
 * A verification step: gates, then cheap mechanical fix retries, then the
 * supervisor's judgment when mechanics are exhausted — escalating with the
 * evidence when even guided retry stays red.
 */
export const verifyStep = ({ run, gitPrefix, planContent, id, coverage, buildFix }: Params): PipelineStep['run'] => {
	// The aftermath of a fix invocation, shared by both retry paths (the
	// cheap-retry loop and the supervisor retry-with-guidance branch): a park
	// check, friction append, report merge into the record, and a re-gate. On
	// rate-limit it signals the caller to park with its own (unmutated) record;
	// otherwise it returns the advanced record and the fresh gate error.
	const applyFix = async ({ fix, record }: { fix: Awaited<ReturnType<PipelineRun['invokeRole']>>; record: StepRecord }) => {
		if (!fix.ok && fix.rateLimited) {
			return { rateLimited: true as const };
		}

		let next = record;

		if (fix.ok) {
			const { report } = fix;

			await appendFriction({ cwd: run.cwd, runId: run.current().runId, step: id, friction: report.friction ?? [] });

			if (report.status === WorkReportStatus.Complete) {
				next = withStepFiles({ record, reports: [report], gitPrefix });

				await run.setStep({ record: { ...next, report }, patch: await collectChanged({ run, gitPrefix, reports: [report] }) });
			}
		}

		const error = await runVerificationGates({ run, coverage });

		return { rateLimited: false as const, record: next, error };
	};

	// One fix attempt: invoke the role with the given error context, apply its
	// aftermath, and surface either a park signal (already stopped) or the
	// advanced record + fresh gate error. Shared by both retry paths.
	const runFix = async ({
		errorContext,
		record,
	}: {
		errorContext: string;
		record: StepRecord;
	}): Promise<{ parked: PipelineResult } | { record: StepRecord; error: string | undefined }> => {
		const fix = await run.invokeRole({ invocation: buildFix(errorContext), step: id });
		const applied = await applyFix({ fix, record });

		if (applied.rateLimited) {
			return { parked: await run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() }) };
		}

		return { record: applied.record, error: applied.error };
	};

	return async () => {
		let record = run.nextRecord({ id });

		await run.setStep({ record });
		run.progress(`step ${id} — attempt ${record.attempts}`);

		let error = await runVerificationGates({ run, coverage });

		// Cheap mechanical retries: hand the role the gate output and re-verify.
		for (let retry = 1; error && retry <= maxCheapFixRetries; retry += 1) {
			record = { ...record, attempts: record.attempts + 1 };

			await run.setStep({ record });
			run.progress(`step ${id}: gate red — fix attempt ${retry}/${maxCheapFixRetries}`);

			const result = await runFix({ errorContext: error, record });

			if ('parked' in result) {
				return result.parked;
			}

			record = result.record;
			error = result.error;
		}

		// Exception path: mechanical retries exhausted — bring in judgment.
		if (error) {
			run.progress(`step ${id}: mechanical retries exhausted — consulting supervisor`);

			const verdict = await consultSupervisor({
				driver: run.driver,
				cwd: run.cwd,
				config: run.config,
				planContent,
				stepId: id,
				errorOutput: error,
				attempts: record.attempts,
				onEvent: run.agentEventSink({ step: `${id}-supervisor` }),
				onRejectedOutput: run.persistRejected({ step: `${id}-supervisor` }),
			});

			await run.recordUsage({ step: `${id}-supervisor`, usage: verdict.usage });

			if (!verdict.ok && verdict.rateLimited) {
				return run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() });
			}

			const ruling = verdict.ok ? verdict.report : undefined;

			if (ruling) {
				run.progress(`step ${id}: supervisor verdict — ${ruling.decision}`);
			}

			if (ruling?.decision === SupervisorDecision.Retry && ruling.guidance) {
				record = { ...record, attempts: record.attempts + 1 };

				await run.setStep({ record });

				const result = await runFix({
					errorContext: `${error}\n\n# Supervisor diagnosis\n${ruling.diagnosis}\n\n# Supervisor guidance\n${ruling.guidance}`,
					record,
				});

				if ('parked' in result) {
					return result.parked;
				}

				record = result.record;
				error = result.error;
			}

			if (error) {
				const diagnosis = ruling ? `\nsupervisor (${ruling.decision}): ${ruling.diagnosis}` : '';

				return run.stop({ record, status: RunStatus.Escalated, error: `${id}: still failing after retries.${diagnosis}\n\n${error}` });
			}
		}

		await run.setStep({ record: { ...record, status: RunStatus.Passed } });
		run.progress(`step ${id} passed`);

		return undefined;
	};
};
