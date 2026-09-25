import type { StepRecord } from '#src/contracts/run/StepRecord.ts';
import type { WorkReport } from '#src/contracts/work/WorkReport.ts';
import { consumerRelative } from '#src/pipeline/common/utils/consumerRelative.ts';

interface Params {
	record: StepRecord;
	reports: WorkReport[];
	gitPrefix?: string;
}

/** Merge report file paths into the step record's own attribution (per-step view of the run-wide `changedFiles`). */
export const withStepFiles = ({ record, reports, gitPrefix }: Params): StepRecord => ({
	...record,
	changedFiles: [
		...new Set([
			...(record.changedFiles ?? []),
			...reports.flatMap((report) => report.changedFiles.map((file) => consumerRelative({ gitPrefix, file: file.path }))),
		]),
	],
});
