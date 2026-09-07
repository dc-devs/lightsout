import type { StepRecord } from '#src/contracts/index.ts';

interface Params {
	record: StepRecord;
}

/** A step record's verification state, or the empty state a first attempt starts from. */
export const verificationOf = ({ record }: Params): NonNullable<StepRecord['verification']> =>
	record.verification ?? {
		failedFamilies: [],
		repairAttempts: {},
		failures: [],
		needsFormatting: false,
		guidedRepairAttempted: false,
	};
