import { RunStatus, type StandardsFinding, type StepRecord, type WorkReport } from '#src/contracts/index.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { describePersistingFindings } from '#src/pipeline/steps/describePersistingFindings.ts';
import { runExecutorPass } from '#src/pipeline/steps/runExecutorPass.ts';
import { standardsWorkList } from '#src/pipeline/steps/standardsWorkList.ts';
import { resolveStandardsChannels } from '#src/standards/index.ts';
import { runStandardsReview } from '#src/standardsCheck/index.ts';
import { type LoadedStandardsPack, resolveStandardsPacks } from '#src/standardsPacks/index.ts';

/**
 * How many refactor passes one step may spend.
 *
 * Two rather than three. The code-checked rules give the same answer every pass,
 * so whatever they flag is fixed in the first pass or is something this step is
 * not allowed to fix at all; what a third pass adds is a fresh reviewer's read
 * of the judgment rules, which finds different things each time rather than
 * finishing the second pass's work. That third pass buys a review, an executor,
 * a formatter and a full gate run for it.
 *
 * The cap, not the trigger: a pass is still bought whenever findings stand,
 * whatever kind they are. LO-104 carries the refinement — a further pass only
 * when a code-checked blocking finding is still standing.
 */
const maxRefactorPasses = 2;

/**
 * The agent's read of the judgment-only rules over this pass's changed files.
 * A review that could not run narrates why and contributes nothing — the
 * machine gate is the real gate, and it must not wait on an opinion.
 */
const reviewAdvisories = async ({ run, packs, channels }: { run: PipelineRun; packs: LoadedStandardsPack[]; channels: string[] }) => {
	const review = await runStandardsReview({
		cwd: run.cwd,
		driver: run.driver,
		packs,
		channels,
		files: sourceFiles({ run }),
		timeoutMs: run.agentTimeoutMs,
		onProgress: (message) => run.progress(message),
	});

	for (const note of review.notes) {
		run.progress(note);
	}

	return review.findings;
};

/**
 * One pass's standards picture: the machine work-list, plus every advisory the
 * checks and the agent review between them raised. The judgment-only rules get
 * read beside the machine checks and their findings join the advisory stream —
 * they are judgment handed to a judge, never work the gate can hold a run on.
 */
const readStandardsGate = async ({ run, packs, channels }: { run: PipelineRun; packs: LoadedStandardsPack[]; channels: string[] }) => {
	const check = await standardsWorkList({ run });
	const advisories = [...check.advisories, ...(await reviewAdvisories({ run, packs, channels }))];

	if (check.workList.length > 0 || advisories.length > 0) {
		run.progress(`standards gate: ${check.workList.length} blocking + ${advisories.length} advisory on changed files`);
	}

	return { workList: check.workList, advisories };
};

/**
 * Where a pass that changed nothing leaves the loop, as members rather than as
 * literals — a caller narrowing on one would otherwise retype the string, and
 * this file is both the caller and the author.
 */
const NoChangeOutcome = {
	Complete: 'complete',
	Escalate: 'escalate',
	Retry: 'retry',
} as const;

/**
 * Where a pass that changed nothing leaves the loop. A work-list the agent
 * declines twice running is a stable disagreement — the agent has judged, the
 * checks cannot hear judgment, and a further pass only re-buys the same answer.
 */
const decideNoChangePass = ({
	run,
	workList,
	pass,
	lastDeclined,
}: {
	run: PipelineRun;
	workList: StandardsFinding[];
	pass: number;
	lastDeclined: string | undefined;
}) => {
	if (workList.length === 0) {
		run.progress(`refactor pass ${pass}: no changes — loop complete`);

		return { kind: NoChangeOutcome.Complete };
	}

	const declined = workList
		.map((finding) => finding.siteKey)
		.sort()
		.join('\n');

	if (declined === lastDeclined && pass < maxRefactorPasses) {
		run.progress(`refactor pass ${pass}: agent declined the same work-list twice — escalating without spending the remaining pass(es)`);
	}

	if (pass === maxRefactorPasses || declined === lastDeclined) {
		return { kind: NoChangeOutcome.Escalate };
	}

	run.progress(`refactor pass ${pass}: no changes but the checks still report ${workList.length} blocking — another pass`);

	return { kind: NoChangeOutcome.Retry, declined };
};

/**
 * The loop can also exhaust its passes while still reporting changes — the gate
 * must not be escapable through that exit, so the tree is re-checked once more.
 */
const readFinalGateStop = async ({ run, record, lastReport }: { run: PipelineRun; record: StepRecord; lastReport: WorkReport | undefined }) => {
	const final = await standardsWorkList({ run });

	return final.workList.length > 0
		? run.stop({
				record: { ...record, report: lastReport },
				status: RunStatus.Escalated,
				error: describePersistingFindings({ findings: final.workList, report: lastReport, passes: maxRefactorPasses }),
			})
		: undefined;
};

/**
 * The standards the agent review reads, resolved once for the whole loop: the
 * gate must not be able to change its mind about the rules between passes.
 */
const resolveReviewStandards = async ({ run }: { run: PipelineRun }) => {
	const packs = await resolveStandardsPacks({ cwd: run.cwd, config: run.config });
	const channels = await resolveStandardsChannels({ cwd: run.cwd, config: run.config, packages: run.current().packages });

	return { packs, channels };
};

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	/** Overview text for a phased run — see `buildRefactorExecutorInvocation`. */
	overviewContent?: string;
	standards?: string;
}

/**
 * The standards-gated refactor loop: iterate until a pass reports complete
 * with zero changed files AND the checks report no work-list findings on the
 * changed files — capped at maxRefactorPasses, with a stable-decline early
 * exit (see `decideNoChangePass`).
 */
export const refactorStep = ({ run, gitPrefix, planContent, overviewContent, standards }: Params): PipelineStep['run'] => {
	return async () => {
		let record = run.nextRecord({ id: 'refactor' });
		let lastReport: WorkReport | undefined;
		let cleanExit = false;

		// Work-list site-key set of the last no-change pass. When the next pass
		// declines the IDENTICAL set, the disagreement is stable. Reset by any
		// pass that changes files.
		let lastDeclined: string | undefined;

		const { packs, channels } = await resolveReviewStandards({ run });

		for (let pass = 1; pass <= maxRefactorPasses; pass += 1) {
			await run.setStep({ record });

			const { workList, advisories } = await readStandardsGate({ run, packs, channels });

			run.progress(`step refactor — pass ${pass}/${maxRefactorPasses}`);

			const executed = await runExecutorPass({ run, gitPrefix, planContent, overviewContent, standards, record, findings: workList, advisories });

			if ('stopped' in executed) {
				return executed.stopped;
			}

			const { report } = executed;

			record = executed.record;
			lastReport = report;

			if (report.changedFiles.length > 0) {
				// The tree changed — the next check is a fresh question, not a repeat.
				lastDeclined = undefined;
				run.progress(`refactor pass ${pass}: ${report.changedFiles.length} change(s)`);
				record = { ...record, attempts: record.attempts + 1 };
				continue;
			}

			// No changes this pass, so the top-of-pass check still describes the
			// tree — no re-check needed to judge the gate.
			const decided = decideNoChangePass({ run, workList, pass, lastDeclined });

			if (decided.kind === NoChangeOutcome.Complete) {
				cleanExit = true;
				break;
			}

			if (decided.kind === NoChangeOutcome.Escalate) {
				return run.stop({
					record: { ...record, report },
					status: RunStatus.Escalated,
					error: describePersistingFindings({ findings: workList, report, passes: pass }),
				});
			}

			lastDeclined = decided.declined;
			record = { ...record, attempts: record.attempts + 1 };
		}

		if (!cleanExit) {
			const stop = await readFinalGateStop({ run, record, lastReport });

			if (stop) {
				return stop;
			}
		}

		await run.setStep({ record: { ...record, status: RunStatus.Passed, report: lastReport } });
		run.progress('step refactor passed');

		return undefined;
	};
};
