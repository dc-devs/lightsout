import { maxCheapFixRetries } from '#src/common/constants/maxCheapFixRetries.ts';
import type { StepRecord } from '#src/contracts/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import type { RepairOutcome } from '#src/pipeline/steps/verifyStep/common/types/RepairOutcome.ts';
import type { VerifyContext } from '#src/pipeline/steps/verifyStep/common/types/VerifyContext.ts';
import { runFix } from '#src/pipeline/steps/verifyStep/common/utils/runFix.ts';
import { verificationOf } from '#src/pipeline/steps/verifyStep/common/utils/verificationOf.ts';
import { withResult } from '#src/pipeline/steps/verifyStep/common/utils/withResult.ts';

interface Params {
	context: VerifyContext;
	record: StepRecord;
	result: VerificationResult;
}

/**
 * The unguided half of the repair budget: hand the red back to the checkpoint's
 * own fix role while any failed family still has attempts left on it.
 */
export const runCheapRepairs = async ({ context, record, result }: Params): Promise<RepairOutcome> => {
	let currentRecord = record;
	let currentResult = result;

	// A crash ends the loop: a red the fix agent must not be shown is a red the loop has nothing left to do about.
	while (currentResult.error && currentResult.crashes.length === 0) {
		const repairable = [...new Set(currentResult.failedFamilies)].filter(
			(family) => (currentRecord.verification?.repairAttempts[family] ?? 0) < maxCheapFixRetries,
		);

		if (repairable.length === 0) {
			break;
		}

		const repairAttempts = { ...currentRecord.verification?.repairAttempts };

		for (const family of repairable) {
			repairAttempts[family] = (repairAttempts[family] ?? 0) + 1;
		}

		currentRecord = {
			...currentRecord,
			attempts: currentRecord.attempts + 1,
			verification: { ...verificationOf({ record: currentRecord }), repairAttempts, needsFormatting: true },
		};
		await context.run.setStep({ record: currentRecord });
		context.run.progress(`step ${context.id}: gate red — repairing ${repairable.join(', ')}`);

		const fixed = await runFix({ context, errorContext: currentResult.error, record: currentRecord });

		if ('parked' in fixed) {
			return { parked: fixed.parked };
		}

		currentRecord = withResult({ record: fixed.record, result: fixed.result });
		currentResult = fixed.result;
		await context.run.setStep({ record: currentRecord });
	}

	return { record: currentRecord, result: currentResult };
};
