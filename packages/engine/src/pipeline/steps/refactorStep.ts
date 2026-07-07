import { buildRefactorExecutorInvocation } from '@lightsout/agents';
import { RunStatus, WorkReportStatus, type WorkReport } from '@lightsout/contracts';
import { appendFriction } from '../../runState';
import type { PipelineRun } from '../PipelineRun';
import type { PipelineStep } from '../PipelineStep';
import { collectChanged } from '../common/utils/collectChanged';
import { sourceFiles } from '../common/utils/sourceFiles';
import { withStepFiles } from '../common/utils/withStepFiles';
import { describePersistingFindings } from './describePersistingFindings';
import { scanWorkList } from './scanWorkList';

const maxRefactorPasses = 3;

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	standards?: string;
}

/**
 * The scan-gated refactor loop: iterate until a pass reports complete with
 * zero changed files AND the scanner reports no gating findings on the
 * changed files — capped at maxRefactorPasses, with a stable-decline early
 * exit (the agent has judged, the scanner cannot hear judgment, and a
 * further pass only re-buys the same answer).
 */
export const refactorStep = ({ run, gitPrefix, planContent, standards }: Params): PipelineStep['run'] => {
	return async () => {
		let record = run.nextRecord({ id: 'refactor' });
		let lastReport: WorkReport | undefined;
		let cleanExit = false;

		// Gating cluster set of the last no-change pass. When the next pass
		// declines the IDENTICAL set, the disagreement is stable. Reset by any
		// pass that changes files.
		let lastDeclined: string | undefined;

		for (let pass = 1; pass <= maxRefactorPasses; pass += 1) {
			await run.setStep({ record });

			const scan = await scanWorkList({ run });

			if (scan.workList.length > 0 || scan.advisories.length > 0) {
				run.progress(
					`scan gate: ${scan.workList.length} finding(s) + ${scan.advisories.length} advisory(ies) on changed files${scan.gating.length > 0 ? ` (${scan.gating.length} gating)` : ''}`,
				);
			}

			run.progress(`step refactor — pass ${pass}/${maxRefactorPasses}`);

			const { report, failure, rateLimited } = await run.invokeRole({
				invocation: buildRefactorExecutorInvocation({
					planContent,
					changedFiles: sourceFiles({ run }),
					standards,
					scanFindings: scan.workList,
					scanAdvisories: scan.advisories,
				}),
				step: 'refactor',
			});

			if (rateLimited) {
				return run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() });
			}

			if (!report) {
				return run.stop({ record, status: RunStatus.Failed, error: failure ?? 'unknown failure' });
			}

			await appendFriction({ cwd: run.cwd, runId: run.current().runId, step: 'refactor', friction: report.friction ?? [] });

			if (report.status !== WorkReportStatus.Complete) {
				const status = report.status === WorkReportStatus.Failed ? RunStatus.Failed : RunStatus.Escalated;

				return run.stop({ record: { ...record, report }, status, error: `refactor: ${report.status} — ${report.failures.join('; ')}` });
			}

			record = withStepFiles({ record, reports: [report], gitPrefix });

			await run.setStep({ record: { ...record, report }, patch: await collectChanged({ run, gitPrefix, reports: [report] }) });
			lastReport = report;

			if (report.changedFiles.length === 0) {
				// No changes this pass, so the top-of-pass scan still describes
				// the tree — no re-scan needed to judge the gate.
				if (scan.gating.length === 0) {
					run.progress(`refactor pass ${pass}: no changes — loop complete`);
					cleanExit = true;
					break;
				}

				const declined = scan.gating
					.map((finding) => finding.cluster)
					.sort()
					.join('\n');

				if (declined === lastDeclined && pass < maxRefactorPasses) {
					run.progress(`refactor pass ${pass}: agent declined the same gating set twice — escalating without spending the remaining pass(es)`);
				}

				if (pass === maxRefactorPasses || declined === lastDeclined) {
					return run.stop({
						record: { ...record, report },
						status: RunStatus.Escalated,
						error: describePersistingFindings({ gating: scan.gating, report, passes: pass }),
					});
				}

				lastDeclined = declined;
				run.progress(`refactor pass ${pass}: no changes but scanner still reports ${scan.gating.length} gating finding(s) — another pass`);
				record = { ...record, attempts: record.attempts + 1 };
				continue;
			}

			// The tree changed — the next scan is a fresh question, not a repeat.
			lastDeclined = undefined;
			run.progress(`refactor pass ${pass}: ${report.changedFiles.length} change(s)`);
			record = { ...record, attempts: record.attempts + 1 };
		}

		// The loop can also exhaust its passes while still reporting changes —
		// the gate must not be escapable through that exit.
		if (!cleanExit) {
			const final = await scanWorkList({ run });

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
