import type { StepRecord } from '#src/contracts/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import { verificationOf } from '#src/pipeline/steps/verifyStep/common/utils/verificationOf.ts';

interface Params {
	record: StepRecord;
	result: VerificationResult;
}

/** The step record with this gate run's verdict written into its verification state. */
export const withResult = ({ record, result }: Params): StepRecord => ({
	...record,
	verification: {
		...verificationOf({ record }),
		failedFamilies: result.failedFamilies,
		failures: result.failures,
	},
});
