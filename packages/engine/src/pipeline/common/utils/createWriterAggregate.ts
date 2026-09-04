import { type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import type { WriterResult } from '#src/pipeline/common/types/WriterResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { appendFriction } from '#src/runState/index.ts';

interface Params<TGroup> {
	run: PipelineRun;
	/** The step the friction entries and progress lines are attributed to. */
	step: string;
	/** How one assignment names itself in a progress line or a failure. */
	label: ({ group }: { group: TGroup }) => string;
}

interface WriterAggregate<TGroup> {
	collect: ({ result }: { result: WriterResult<TGroup> }) => Promise<void>;
	isParked: () => boolean;
	result: () => { reports: WorkReport[]; failures: string[]; terminated: boolean; parked: boolean };
}

/**
 * A fan-out's running aggregate. Every writer result folds in here, wherever it
 * lands: a rate limit parks the run, an absent report is a failure, and a report
 * contributes its friction, its status, and its changed files.
 *
 * @typeParam TGroup - the assignment each writer was given; only `label` reads it.
 */
export const createWriterAggregate = <TGroup>({ run, step, label }: Params<TGroup>): WriterAggregate<TGroup> => {
	const reports: WorkReport[] = [];
	const failures: string[] = [];
	let terminated = false;
	let parked = false;

	const collect = async ({ result }: { result: WriterResult<TGroup> }) => {
		const name = label({ group: result.group });

		if (!result.ok) {
			if (result.rateLimited) {
				parked = true;
			} else {
				failures.push(`${name}: ${result.failure}`);
			}

			return;
		}

		const { report } = result;

		await appendFriction({ cwd: run.cwd, runId: run.current().runId, step, friction: report.friction ?? [] });
		reports.push(report);
		run.progress(`${step}: ${name} — ${report.status}`);

		if (report.status !== WorkReportStatus.Complete) {
			terminated = terminated || report.status !== WorkReportStatus.Failed;
			failures.push(`${name}: ${report.status} — ${report.failures.join('; ')}`);
		}
	};

	return { collect, isParked: () => parked, result: () => ({ reports, failures, terminated, parked }) };
};
