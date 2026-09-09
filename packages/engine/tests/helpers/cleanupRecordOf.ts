import { RefactorStepReport, type StepRecord } from '#src/contracts/index.ts';

interface Params {
	/** The run manifest's step records. */
	steps: StepRecord[];
}

/**
 * The cleanup record the refactor step left on its own step record, read back
 * through its own contract the way every reader of that slot must — or
 * `undefined` when the step left none, which is also what an older engine's
 * record reads as.
 */
export const cleanupRecordOf = ({ steps }: Params): RefactorStepReport | undefined =>
	RefactorStepReport.safeParse(steps.find((step) => step.id === 'refactor')?.report).data;
