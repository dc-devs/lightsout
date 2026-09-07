import { RunStatus, type StepRecord, SupervisorDecision } from '#src/contracts/index.ts';
import { stopOnGateCrash } from '#src/pipeline/common/utils/stopOnGateCrash.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { reviewAndVerify } from '#src/pipeline/steps/verify/index.ts';
import type { RepairOutcome } from '#src/pipeline/steps/verifyStep/common/types/RepairOutcome.ts';
import type { VerifyContext } from '#src/pipeline/steps/verifyStep/common/types/VerifyContext.ts';
import { formatAndVerify } from '#src/pipeline/steps/verifyStep/common/utils/formatAndVerify.ts';
import { runCheapRepairs } from '#src/pipeline/steps/verifyStep/common/utils/runCheapRepairs.ts';
import { runGuidedRepair } from '#src/pipeline/steps/verifyStep/common/utils/runGuidedRepair.ts';
import { withResult } from '#src/pipeline/steps/verifyStep/common/utils/withResult.ts';

/** The first entry into the checkpoint when no formatter pass is owed: the review, then the gates. */
const enterVerification = async ({ context, record }: { context: VerifyContext; record: StepRecord }): Promise<RepairOutcome> => {
	const { run, id, coverage, final, planContent, overviewContent, acceptanceTests } = context;
	const result = await reviewAndVerify({ run, id, coverage, final, planContent, overviewContent, acceptanceTests });

	if ('rateLimited' in result) {
		return { parked: await run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() }) };
	}

	return { record, result };
};

const runVerificationStep = async ({ context }: { context: VerifyContext }) => {
	const { run, id } = context;
	const previous = run.current().steps.find((step) => step.id === id);
	let record: StepRecord = { ...run.nextRecord({ id }), ...(previous?.verification ? { verification: previous.verification } : {}) };

	await run.setStep({ record });
	run.progress(`step ${id} — attempt ${record.attempts}`);

	const initial = record.verification?.needsFormatting ? await formatAndVerify({ context, record }) : await enterVerification({ context, record });

	if ('parked' in initial) {
		return initial.parked;
	}

	let result = initial.result;
	record = initial.record;

	if (result.error) {
		record = withResult({ record, result });
		await run.setStep({ record });
	}

	const repaired = await runCheapRepairs({ context, record, result });

	if ('parked' in repaired) {
		return repaired.parked;
	}

	const guided = await runGuidedRepair({ context, ...repaired });

	if ('parked' in guided) {
		return guided.parked;
	}

	({ record, result } = guided);

	// Both repair stages step aside for a crash, so one check here catches it wherever it appeared.
	if (result.crashes.length > 0) {
		return stopOnGateCrash({ run, stepId: id, record, crashes: result.crashes, error: result.error });
	}

	if (result.error) {
		const diagnosis = record.verification?.supervisorDiagnosis;
		const decision = guided.ruling?.decision ?? (record.verification?.guidedRepairAttempted ? SupervisorDecision.Retry : undefined);
		const detail = diagnosis && decision ? `\nsupervisor (${decision}): ${diagnosis}` : '';

		return run.stop({ record, status: RunStatus.Escalated, error: `${id}: still failing after retries.${detail}\n\n${result.error}` });
	}

	const passedRecord = record.verification
		? { ...record, verification: { ...record.verification, failedFamilies: [], failures: [], needsFormatting: false } }
		: record;

	await run.setStep({ record: { ...passedRecord, status: RunStatus.Passed } });
	run.progress(`step ${id} passed`);

	return undefined;
};

/**
 * One verification checkpoint: format, judge every change made to a test-side
 * file, run the gates, and repair a red under a fixed budget — cheap retries per
 * failed family, then one supervisor-guided turn — before escalating the run.
 *
 * The review runs before the gates and can itself go red, under the
 * `test-review` family, without a gate being spent. It rides this budget rather
 * than opening one of its own.
 */
export const verifyStep = ({
	run,
	gitPrefix,
	planContent,
	overviewContent,
	id,
	coverage,
	acceptanceTests,
	final,
	buildFix,
}: VerifyContext): PipelineStep['run'] => {
	const context: VerifyContext = { run, gitPrefix, planContent, overviewContent, id, coverage, acceptanceTests, final, buildFix };

	return () => runVerificationStep({ context });
};
