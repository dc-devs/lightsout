import { runFormatter } from '#src/common/processes/runFormatter.ts';
import { type GateResult, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { reviewAndVerify } from '#src/pipeline/steps/verify/index.ts';
import type { RepairOutcome } from '#src/pipeline/steps/verifyStep/common/types/RepairOutcome.ts';
import type { VerifyContext } from '#src/pipeline/steps/verifyStep/common/types/VerifyContext.ts';
import { verificationOf } from '#src/pipeline/steps/verifyStep/common/utils/verificationOf.ts';

interface Params {
	context: VerifyContext;
	record: StepRecord;
}

/**
 * The formatter, then the review, then the gates — the order every repair
 * attempt re-enters the checkpoint by. A formatter that fails is itself the
 * verdict, under the `format` family, and nothing is judged or run on a tree it
 * could not settle.
 *
 * The review can be rate limited, so this can park: a throttled reviewer said
 * nothing about the tests, and there is no verdict to repair and no failure to
 * escalate.
 */
export const formatAndVerify = async ({ context, record }: Params): Promise<RepairOutcome> => {
	const { run, id, coverage, final, planContent, overviewContent, acceptanceTests } = context;
	const failures: GateResult[] = [];
	const error = await runFormatter({
		cwd: run.cwd,
		runId: run.current().runId,
		config: run.config,
		step: id,
		onResult: (result) => failures.push(result),
	});
	const next = { ...record, verification: { ...verificationOf({ record }), needsFormatting: false } };

	await run.setStep({ record: next });

	if (error !== undefined) {
		return { record: next, result: { error, failedFamilies: ['format'], crashes: [], coordination: undefined, failures, gates: [] } };
	}

	const result = await reviewAndVerify({ run, id, coverage, final, planContent, overviewContent, acceptanceTests });

	if ('rateLimited' in result) {
		return { parked: await run.stop({ record: next, status: RunStatus.PausedRateLimit, error: run.parkMessage() }) };
	}

	return { record: next, result };
};
