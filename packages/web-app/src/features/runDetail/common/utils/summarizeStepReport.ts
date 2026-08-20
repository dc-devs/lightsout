import { BatchReport, PhaseReport, WorkReport, WritersReport } from '@lightsout/engine/contracts';
import { StepReportKind } from '#src/features/runDetail/common/constants/StepReportKind.ts';
import type { StepReport } from '#src/features/runDetail/common/types/StepReport.ts';

/**
 * The write-tests envelope read as one summary: how many writer batches ran,
 * how many files they touched between them, and how each of them ended.
 */
const summarizeWriters = ({ reports }: { reports: WorkReport[] }) => {
	const statuses: Record<string, number> = {};
	let fileCount = 0;

	for (const report of reports) {
		statuses[report.status] = (statuses[report.status] ?? 0) + 1;
		fileCount += report.changedFiles.length;
	}

	const summary: StepReport = {
		kind: StepReportKind.Writers,
		count: reports.length,
		fileCount,
		statuses,
		summaries: reports.map((report) => report.summary),
	};

	return summary;
};

interface Params {
	/** The step's `report` field, exactly as the manifest stores it. */
	report: unknown;
}

/**
 * Read a step's opaque report by shape; anything unrecognized degrades to
 * pretty-printed JSON rather than taking the page down.
 *
 * The only place in this app that inspects an engine value's shape instead of
 * reading a declared field, and deliberately so: `StepRecord.report` is
 * `z.unknown()` precisely because the manifest stores it opaquely, so someone
 * has to look. Each candidate is the engine's own schema, tried most specific
 * first.
 *
 * @returns undefined when the step recorded no report at all
 */
export const summarizeStepReport = ({ report }: Params): StepReport | undefined => {
	if (report === undefined) {
		return undefined;
	}

	const batch = BatchReport.safeParse(report);
	const phase = PhaseReport.safeParse(report);
	const writers = WritersReport.safeParse(report);
	const work = WorkReport.safeParse(report);
	let summary: StepReport;

	if (batch.success) {
		summary = {
			kind: StepReportKind.Batch,
			outcome: batch.data.outcome,
			remaining: batch.data.remainingSiteKeys.length,
			rationale: batch.data.rationale,
			advisories: batch.data.advisoryOutcomes ?? [],
		};
	} else if (phase.success) {
		summary = { kind: StepReportKind.Phase, runId: phase.data.runId };
	} else if (writers.success) {
		summary = summarizeWriters({ reports: writers.data.reports });
	} else if (work.success) {
		summary = {
			kind: StepReportKind.Work,
			status: work.data.status,
			summary: work.data.summary,
			files: work.data.changedFiles,
			failures: work.data.failures,
		};
	} else {
		// Cut rather than paginated: past a few thousand characters this is a file
		// to open, not a panel to read.
		summary = { kind: StepReportKind.Raw, text: JSON.stringify(report, null, 2).slice(0, 4_000) };
	}

	return summary;
};
