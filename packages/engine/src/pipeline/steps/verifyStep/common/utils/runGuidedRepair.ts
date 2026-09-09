import { consultSupervisor } from '#src/common/utils/consultSupervisor.ts';
import { RunStatus, type StepRecord, SupervisorDecision } from '#src/contracts/index.ts';
import type { VerificationResult } from '#src/pipeline/common/types/VerificationResult.ts';
import type { GuidedRepairOutcome } from '#src/pipeline/steps/verifyStep/common/types/GuidedRepairOutcome.ts';
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
 * The guided half of the repair budget, spent once: the supervisor rules on the
 * red the cheap retries could not clear, and its guidance buys one more turn of
 * the fix role.
 */
export const runGuidedRepair = async ({ context, record, result }: Params): Promise<GuidedRepairOutcome> => {
	// A crashed gate buys no judgment either — the supervisor would be asked to rule on a toolchain fault. A red with no failed family
	// is that same shape: the checkpoint could not be run, so there is nothing to rule on and nothing to repair — as `runCheapRepairs` decides too.
	// A gate run that never got the machine is the plainest case of it: not one command executed, so the supervisor would rule on nothing at all.
	if (
		!result.error ||
		result.failedFamilies.length === 0 ||
		result.crashes.length > 0 ||
		result.coordination !== undefined ||
		record.verification?.guidedRepairAttempted
	) {
		return { record, result, ruling: undefined };
	}

	const { run, id, planContent } = context;
	run.progress(`step ${id}: mechanical retries exhausted — consulting supervisor`);
	const verdict = await consultSupervisor({
		driver: run.driver,
		cwd: run.cwd,
		config: run.config,
		planContent,
		stepId: id,
		errorOutput: result.error,
		attempts: record.attempts,
		onEvent: run.agentEventSink({ step: `${id}-supervisor` }),
		onRejectedOutput: run.persistRejected({ step: `${id}-supervisor` }),
	});
	await run.recordUsage({ step: `${id}-supervisor`, usage: verdict.usage });

	if (!verdict.ok && verdict.rateLimited) {
		return { parked: await run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() }) };
	}

	const ruling = verdict.ok ? verdict.report : undefined;
	let next = record;

	if (ruling) {
		run.progress(`step ${id}: supervisor verdict — ${ruling.decision}`);
		next = { ...record, verification: { ...verificationOf({ record }), supervisorDiagnosis: ruling.diagnosis } };
		await run.setStep({ record: next });
	}

	if (ruling?.decision !== SupervisorDecision.Retry || !ruling.guidance) {
		return { record: next, result, ruling };
	}

	next = {
		...next,
		attempts: next.attempts + 1,
		verification: { ...verificationOf({ record: next }), guidedRepairAttempted: true, needsFormatting: true },
	};
	await run.setStep({ record: next });

	const fixed = await runFix({
		context,
		errorContext: `${result.error}\n\n# Supervisor diagnosis\n${ruling.diagnosis}\n\n# Supervisor guidance\n${ruling.guidance}`,
		record: next,
	});

	if ('parked' in fixed) {
		return { parked: fixed.parked };
	}

	const finalRecord = withResult({ record: fixed.record, result: fixed.result });
	await run.setStep({ record: finalRecord });

	return { record: finalRecord, result: fixed.result, ruling };
};
