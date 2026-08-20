import type { StepReportKind } from '#src/features/runDetail/common/constants/StepReportKind.ts';

/** A refactor batch: how it ended, what it left behind, and what it did about the advice it was shown. */
interface BatchStepReport {
	kind: typeof StepReportKind.Batch;
	outcome: string;
	/** Site keys still present after the batch. */
	remaining: number;
	rationale: string[];
	advisories: { rule: string; siteKey: string; outcome: string; reason?: string }[];
}

/** A coordinator step: the child run that implemented the phase. */
interface PhaseStepReport {
	kind: typeof StepReportKind.Phase;
	runId: string;
}

/** The write-tests step: how many writer batches ran, and how they ended. */
interface WritersStepReport {
	kind: typeof StepReportKind.Writers;
	count: number;
	fileCount: number;
	statuses: Record<string, number>;
	summaries: string[];
}

/** A working agent's own report of what it changed and what fought it. */
interface WorkStepReport {
	kind: typeof StepReportKind.Work;
	status: string;
	summary: string;
	files: { path: string; summary: string }[];
	failures: string[];
}

/** A report matching no contract this app knows — its JSON, so the evidence is still readable. */
interface RawStepReport {
	kind: typeof StepReportKind.Raw;
	text: string;
}

/**
 * A step's report, read by shape.
 *
 * The member shapes stay unexported: they exist only as constituents of this
 * union, and a consumer narrows on `kind` rather than naming one.
 *
 * `StepRecord.report` is `z.unknown()` because the manifest stores it opaquely —
 * its shape belongs to whichever role produced it — so the only way to show one
 * is to try each contract and say so honestly when none fits.
 */
export type StepReport = BatchStepReport | PhaseStepReport | WritersStepReport | WorkStepReport | RawStepReport;
