import { buildRefactorExecutorInvocation } from '@/agents';
import { RunStatus, WorkReportStatus, type WorkReport } from '@/contracts';
import { appendFriction } from '@/runState';
import type { PipelineRun } from '@/pipeline/PipelineRun';
import type { PipelineStep } from '@/pipeline/PipelineStep';
import { collectChanged } from '@/pipeline/common/utils/collectChanged';
import { invokeRoleOrStop } from '@/pipeline/common/utils/invokeRoleOrStop';
import { sourceFiles } from '@/pipeline/common/utils/sourceFiles';
import { withStepFiles } from '@/pipeline/common/utils/withStepFiles';
import { describePersistingFindings } from '@/pipeline/steps/describePersistingFindings';
import { standardsWorkList } from '@/pipeline/steps/standardsWorkList';

const maxRefactorPasses = 3;

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	standards?: string;
}

/**
 * The standards-gated refactor loop: iterate until a pass reports complete
 * with zero changed files AND the checks report no gating findings on the
 * changed files — capped at maxRefactorPasses, with a stable-decline early
 * exit (the agent has judged, the checks cannot hear judgment, and a
 * further pass only re-buys the same answer).
 */
export const refactorStep = ({ run, gitPrefix, planContent, standards }: Params): PipelineStep['run'] => {
	return async () => {
		let record = run.nextRecord({ id: 'refactor' });
		let lastReport: WorkReport | undefined;
		let cleanExit = false;

		// Gating site-key set of the last no-change pass. When the next pass
		// declines the IDENTICAL set, the disagreement is stable. Reset by any
		// pass that changes files.
		let lastDeclined: string | undefined;

		for (let pass = 1; pass <= maxRefactorPasses; pass += 1) {
			await run.setStep({ record });

			const check = await standardsWorkList({ run });

			if (check.workList.length > 0 || check.advisories.length > 0) {
				run.progress(
					`standards gate: ${check.workList.length} finding(s) + ${check.advisories.length} advisory(ies) on changed files${check.gating.length > 0 ? ` (${check.gating.length} gating)` : ''}`,
				);
			}

			run.progress(`step refactor — pass ${pass}/${maxRefactorPasses}`);

			const outcome = await invokeRoleOrStop({
				run,
				record,
				invocation: buildRefactorExecutorInvocation({
					planContent,
					changedFiles: sourceFiles({ run }),
					standards,
					findings: check.workList,
					advisories: check.advisories,
				}),
				step: 'refactor',
			});

			if ('stopped' in outcome) {
				return outcome.stopped;
			}

			const { report } = outcome;

			await appendFriction({ cwd: run.cwd, runId: run.current().runId, step: 'refactor', friction: report.friction ?? [] });

			if (report.status !== WorkReportStatus.Complete) {
				const status = report.status === WorkReportStatus.Failed ? RunStatus.Failed : RunStatus.Escalated;

				return run.stop({ record: { ...record, report }, status, error: `refactor: ${report.status} — ${report.failures.join('; ')}` });
			}

			record = withStepFiles({ record, reports: [report], gitPrefix });

			await run.setStep({ record: { ...record, report }, patch: await collectChanged({ run, gitPrefix, reports: [report] }) });
			lastReport = report;

			if (report.changedFiles.length === 0) {
				// No changes this pass, so the top-of-pass check still describes
				// the tree — no re-check needed to judge the gate.
				if (check.gating.length === 0) {
					run.progress(`refactor pass ${pass}: no changes — loop complete`);
					cleanExit = true;
					break;
				}

				const declined = check.gating
					.map((finding) => finding.siteKey)
					.sort()
					.join('\n');

				if (declined === lastDeclined && pass < maxRefactorPasses) {
					run.progress(`refactor pass ${pass}: agent declined the same gating set twice — escalating without spending the remaining pass(es)`);
				}

				if (pass === maxRefactorPasses || declined === lastDeclined) {
					return run.stop({
						record: { ...record, report },
						status: RunStatus.Escalated,
						error: describePersistingFindings({ gating: check.gating, report, passes: pass }),
					});
				}

				lastDeclined = declined;
				run.progress(`refactor pass ${pass}: no changes but the checks still report ${check.gating.length} gating finding(s) — another pass`);
				record = { ...record, attempts: record.attempts + 1 };
				continue;
			}

			// The tree changed — the next check is a fresh question, not a repeat.
			lastDeclined = undefined;
			run.progress(`refactor pass ${pass}: ${report.changedFiles.length} change(s)`);
			record = { ...record, attempts: record.attempts + 1 };
		}

		// The loop can also exhaust its passes while still reporting changes —
		// the gate must not be escapable through that exit.
		if (!cleanExit) {
			const final = await standardsWorkList({ run });

			if (final.gating.length > 0) {
				return run.stop({
					record: { ...record, report: lastReport },
					status: RunStatus.Escalated,
					error: describePersistingFindings({ gating: final.gating, report: lastReport, passes: maxRefactorPasses }),
				});
			}
		}

		await run.setStep({ record: { ...record, status: RunStatus.Passed, report: lastReport } });
		run.progress('step refactor passed');

		return undefined;
	};
};
