import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { GradeReport } from '#src/contracts/index.ts';
import { gradeHistoryPath } from '#src/plan/gradeHistoryPath.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** The pass as it was just written to the latest-grade file — complete or partial. */
	report: GradeReport;
}

/**
 * Append one finished grading pass to the plan's history ledger, as a single
 * JSON line. The report is parsed against its own contract on the way out, so a
 * malformed line can never be written and then silently skipped on the way back
 * in.
 *
 * This does NOT go through `appendJsonlRecords`: that writer stamps `at`,
 * `runId` and `step` provenance on every entry, and a grading pass has no run to
 * name — inventing a `runId` to reach the shared writer would put a fiction in
 * the record. The report already carries its own `gradedAt` and `gradedCommit`,
 * which is what says when the pass ran and against what.
 *
 * The directory is created here rather than assumed, so the function is correct
 * when called on its own.
 */
export const appendGradeHistory = async ({ cwd, name, report }: Params): Promise<void> => {
	const path = gradeHistoryPath({ cwd, name });

	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${JSON.stringify(GradeReport.parse(report))}\n`, 'utf8');
};
