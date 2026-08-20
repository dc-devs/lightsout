import { buildRefactorExecutorInvocation } from '#src/agents/index.ts';
import { RunStatus, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { collectChanged } from '#src/pipeline/common/utils/collectChanged.ts';
import { invokeRoleOrStop } from '#src/pipeline/common/utils/invokeRoleOrStop.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import { withStepFiles } from '#src/pipeline/common/utils/withStepFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { describePersistingFindings } from '#src/pipeline/steps/describePersistingFindings.ts';
import { standardsWorkList } from '#src/pipeline/steps/standardsWorkList.ts';
import { appendFriction } from '#src/runState/index.ts';
import { detectStandardsChannels } from '#src/standards/index.ts';
import { runStandardsReview } from '#src/standardsCheck/index.ts';
import { type LoadedStandardsPackage, resolveStandardsPackages } from '#src/standardsPackages/index.ts';

const maxRefactorPasses = 3;

/**
 * The agent's read of the judgment-only rules over this pass's changed files.
 * A review that could not run narrates why and contributes nothing — the
 * machine gate is the real gate, and it must not wait on an opinion.
 */
const reviewAdvisories = async ({ run, packages, channels }: { run: PipelineRun; packages: LoadedStandardsPackage[]; channels: string[] }) => {
	const review = await runStandardsReview({
		cwd: run.cwd,
		driver: run.driver,
		packages,
		channels,
		files: sourceFiles({ run }),
		timeoutMs: run.agentTimeoutMs,
		onProgress: (message) => run.progress(`agent review: ${message}`),
	});

	for (const note of review.notes) {
		run.progress(note);
	}

	return review.findings;
};

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	standards?: string;
}

/**
 * The standards-gated refactor loop: iterate until a pass reports complete
 * with zero changed files AND the checks report no work-list findings on the
 * changed files — capped at maxRefactorPasses, with a stable-decline early
 * exit (the agent has judged, the checks cannot hear judgment, and a
 * further pass only re-buys the same answer).
 */
export const refactorStep = ({ run, gitPrefix, planContent, standards }: Params): PipelineStep['run'] => {
	return async () => {
		let record = run.nextRecord({ id: 'refactor' });
		let lastReport: WorkReport | undefined;
		let cleanExit = false;

		// Work-list site-key set of the last no-change pass. When the next pass
		// declines the IDENTICAL set, the disagreement is stable. Reset by any
		// pass that changes files.
		let lastDeclined: string | undefined;

		// The standards the agent review reads are the run's, resolved once: the
		// gate must not be able to change its mind about the rules between passes.
		const packages = await resolveStandardsPackages({ cwd: run.cwd, config: run.config });
		const channels =
			run.config['standards-channels'] ??
			(await detectStandardsChannels({ cwd: run.cwd, packagesDir: run.config['packages-dir'] ?? 'packages', packages: run.current().packages }));

		for (let pass = 1; pass <= maxRefactorPasses; pass += 1) {
			await run.setStep({ record });

			const check = await standardsWorkList({ run });
			// The judgment-only rules get read by an agent beside the machine
			// checks, and its findings join the advisory stream — they are judgment
			// handed to a judge, never work the gate can hold a run on.
			const advisories = [...check.advisories, ...(await reviewAdvisories({ run, packages, channels }))];

			if (check.workList.length > 0 || advisories.length > 0) {
				run.progress(`standards gate: ${check.workList.length} blocking + ${advisories.length} advisory on changed files`);
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
					advisories,
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
				if (check.workList.length === 0) {
					run.progress(`refactor pass ${pass}: no changes — loop complete`);
					cleanExit = true;
					break;
				}

				const declined = check.workList
					.map((finding) => finding.siteKey)
					.sort()
					.join('\n');

				if (declined === lastDeclined && pass < maxRefactorPasses) {
					run.progress(`refactor pass ${pass}: agent declined the same work-list twice — escalating without spending the remaining pass(es)`);
				}

				if (pass === maxRefactorPasses || declined === lastDeclined) {
					return run.stop({
						record: { ...record, report },
						status: RunStatus.Escalated,
						error: describePersistingFindings({ findings: check.workList, report, passes: pass }),
					});
				}

				lastDeclined = declined;
				run.progress(`refactor pass ${pass}: no changes but the checks still report ${check.workList.length} blocking — another pass`);
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

			if (final.workList.length > 0) {
				return run.stop({
					record: { ...record, report: lastReport },
					status: RunStatus.Escalated,
					error: describePersistingFindings({ findings: final.workList, report: lastReport, passes: maxRefactorPasses }),
				});
			}
		}

		await run.setStep({ record: { ...record, status: RunStatus.Passed, report: lastReport } });
		run.progress('step refactor passed');

		return undefined;
	};
};
