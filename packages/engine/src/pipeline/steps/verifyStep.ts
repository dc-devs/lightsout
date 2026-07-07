import { buildSupervisorInvocation } from '@lightsout/agents';
import { RunStatus, SupervisorDecision, SupervisorVerdict, WorkReportStatus, type StepRecord } from '@lightsout/contracts';
import { invokeAgentWithContract } from '../../invoke';
import { appendFriction } from '../../runState';
import type { PipelineRun } from '../PipelineRun';
import type { PipelineStep } from '../PipelineStep';
import { collectChanged } from '../common/utils/collectChanged';
import { gates } from '../common/utils/gates';
import { withStepFiles } from '../common/utils/withStepFiles';

const maxCheapFixRetries = 2;
const defaultSupervisorTimeoutMinutes = 15;
const supervisorPermissionMode = 'plan';

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
	const supervisorTimeoutMs = (run.config.timeouts?.supervisorMinutes ?? defaultSupervisorTimeoutMinutes) * 60_000;

	// The aftermath of a fix invocation, shared by both retry paths (the
	// cheap-retry loop and the supervisor retry-with-guidance branch): a park
	// check, friction append, report merge into the record, and a re-gate. On
	// rate-limit it signals the caller to park with its own (unmutated) record;
	// otherwise it returns the advanced record and the fresh gate error.
	const applyFix = async ({ fix, record }: { fix: Awaited<ReturnType<PipelineRun['invokeRole']>>; record: StepRecord }) => {
		if (fix.rateLimited) {
			return { rateLimited: true as const };
		}

		if (fix.report) {
			await appendFriction({ cwd: run.cwd, runId: run.current().runId, step: id, friction: fix.report.friction ?? [] });
		}

		let next = record;

		if (fix.report?.status === WorkReportStatus.Complete) {
			next = withStepFiles({ record, reports: [fix.report], gitPrefix });

			await run.setStep({ record: { ...next, report: fix.report }, patch: await collectChanged({ run, gitPrefix, reports: [fix.report] }) });
		}

		const error = await gates({ run, coverage });

		return { rateLimited: false as const, record: next, error };
	};

	return async () => {
		let record = run.nextRecord({ id });

		await run.setStep({ record });
		run.progress(`step ${id} — attempt ${record.attempts}`);

		let error = await gates({ run, coverage });

		// Cheap mechanical retries: hand the role the gate output and re-verify.
		for (let retry = 1; error && retry <= maxCheapFixRetries; retry += 1) {
			record = { ...record, attempts: record.attempts + 1 };

			await run.setStep({ record });
			run.progress(`step ${id}: gate red — fix attempt ${retry}/${maxCheapFixRetries}`);

			const fix = await run.invokeRole({ invocation: buildFix(error), step: id });
			const applied = await applyFix({ fix, record });

			if (applied.rateLimited) {
				return run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() });
			}

			record = applied.record;
			error = applied.error;
		}

		// Exception path: mechanical retries exhausted — bring in judgment.
		if (error) {
			run.progress(`step ${id}: mechanical retries exhausted — consulting supervisor (ceiling ${supervisorTimeoutMs / 60_000}m)`);

			const verdict = await invokeAgentWithContract({
				driver: run.driver,
				cwd: run.cwd,
				invocation: buildSupervisorInvocation({ planContent, stepId: id, errorOutput: error, attempts: record.attempts }),
				contract: SupervisorVerdict,
				model: run.config.model,
				permissionMode: supervisorPermissionMode,
				timeoutMs: supervisorTimeoutMs,
				onEvent: run.agentEventSink({ step: `${id}-supervisor` }),
				onRejectedOutput: run.persistRejected({ step: `${id}-supervisor` }),
			});

			await run.recordUsage({ step: `${id}-supervisor`, usage: verdict.usage });

			if (verdict.rateLimited) {
				return run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() });
			}

			if (verdict.report) {
				run.progress(`step ${id}: supervisor verdict — ${verdict.report.decision}`);
			}

			if (verdict.report?.decision === SupervisorDecision.Retry && verdict.report.guidance) {
				record = { ...record, attempts: record.attempts + 1 };

				await run.setStep({ record });

				const fix = await run.invokeRole({
					invocation: buildFix(`${error}\n\n# Supervisor diagnosis\n${verdict.report.diagnosis}\n\n# Supervisor guidance\n${verdict.report.guidance}`),
					step: id,
				});
				const applied = await applyFix({ fix, record });

				if (applied.rateLimited) {
					return run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() });
				}

				record = applied.record;
				error = applied.error;
			}

			if (error) {
				const diagnosis = verdict.report ? `\nsupervisor (${verdict.report.decision}): ${verdict.report.diagnosis}` : '';

				return run.stop({ record, status: RunStatus.Escalated, error: `${id}: still failing after retries.${diagnosis}\n\n${error}` });
			}
		}

		await run.setStep({ record: { ...record, status: RunStatus.Passed } });
		run.progress(`step ${id} passed`);

		return undefined;
	};
};
