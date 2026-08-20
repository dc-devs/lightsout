import { RunStatus, WorkReportStatus } from '#src/contracts/index.ts';
import { collectChanged } from '#src/pipeline/common/utils/collectChanged.ts';
import { invokeRoleOrStop } from '#src/pipeline/common/utils/invokeRoleOrStop.ts';
import { withStepFiles } from '#src/pipeline/common/utils/withStepFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { appendFriction } from '#src/runState/index.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	id: string;
	build: () => { systemPrompt: string; prompt: string };
	/** Fail the run when the step completes without changing anything — a no-op "success" is a lie. */
	requireChanges?: boolean;
}

/** A working-role step: invoke the agent, capture friction, merge changed-file truth, persist the verdict. */
export const workStep = ({ run, gitPrefix, id, build, requireChanges }: Params): PipelineStep['run'] => {
	return async () => {
		const record = run.nextRecord({ id });

		await run.setStep({ record });
		run.progress(`step ${id} — attempt ${record.attempts} · invoking agent (ceiling ${run.agentTimeoutMs / 60_000}m)`);

		const outcome = await invokeRoleOrStop({ run, record, invocation: build(), step: id });

		if ('stopped' in outcome) {
			return outcome.stopped;
		}

		const { report } = outcome;

		run.progress(`step ${id}: agent report ${report.status} — ${report.changedFiles.length} changed file(s)`);

		// Friction is captured regardless of outcome — a terminated run's
		// confusion is exactly the signal the improvement loop needs.
		await appendFriction({ cwd: run.cwd, runId: run.current().runId, step: id, friction: report.friction ?? [] });

		if (report.status !== WorkReportStatus.Complete) {
			// Termination statuses need a human (plan defect, scope); a plain
			// failed report is a failure. Both stop the run; only the state differs.
			const status = report.status === WorkReportStatus.Failed ? RunStatus.Failed : RunStatus.Escalated;

			return run.stop({
				record: { ...record, report },
				status,
				error: `${id}: ${report.status} — ${report.failures.join('; ')}`,
			});
		}

		const changed = await collectChanged({ run, gitPrefix, reports: [report] });

		if (requireChanges && changed.changedFiles.length === 0) {
			return run.stop({
				record: { ...record, report },
				status: RunStatus.Failed,
				error: `${id}: agent reported complete but neither its report nor git shows a single changed file — nothing was implemented, and a green verify on an unchanged codebase would be a misleading success.`,
			});
		}

		await run.setStep({
			record: withStepFiles({ record: { ...record, status: RunStatus.Passed, report }, reports: [report], gitPrefix }),
			patch: changed,
		});
		run.progress(`step ${id} passed`);

		return undefined;
	};
};
