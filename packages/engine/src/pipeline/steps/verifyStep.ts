import { maxCheapFixRetries } from '#src/common/constants/maxCheapFixRetries.ts';
import { runFormatter } from '#src/common/processes/runFormatter.ts';
import { consultSupervisor } from '#src/common/utils/consultSupervisor.ts';
import { type GateResult, RunStatus, type StepRecord, SupervisorDecision, WorkReportStatus } from '#src/contracts/index.ts';
import { collectChanged } from '#src/pipeline/common/utils/collectChanged.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import { stopOnGateCrash } from '#src/pipeline/common/utils/stopOnGateCrash.ts';
import { withStepFiles } from '#src/pipeline/common/utils/withStepFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import { appendFriction } from '#src/runState/index.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	id: string;
	coverage?: boolean;
	buildFix: ({ errorContext }: { errorContext: string }) => { systemPrompt: string; prompt: string };
}

type VerificationResult = Awaited<ReturnType<typeof runVerificationGates>>;

const verificationOf = ({ record }: { record: StepRecord }) =>
	record.verification ?? {
		failedFamilies: [],
		repairAttempts: {},
		failures: [],
		needsFormatting: false,
		guidedRepairAttempted: false,
	};

const withResult = ({ record, result }: { record: StepRecord; result: VerificationResult }) => ({
	...record,
	verification: {
		...verificationOf({ record }),
		failedFamilies: result.failedFamilies,
		failures: result.failures,
	},
});

const formatAndVerify = async ({ context: { run, id, coverage }, record }: { context: Params; record: StepRecord }) => {
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

	return {
		record: next,
		result: error === undefined ? await runVerificationGates({ run, coverage, checkpoint: id }) : { error, failedFamilies: ['format'], crashes: [], failures },
	};
};

const runFix = async ({ context, errorContext, record }: { context: Params; errorContext: string; record: StepRecord }) => {
	const { run, gitPrefix, id } = context;
	const fix = await run.invokeRole({ invocation: context.buildFix({ errorContext }), step: id });

	if (!fix.ok && fix.rateLimited) {
		return { parked: await run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() }) };
	}

	let next = record;

	if (fix.ok) {
		const { report } = fix;

		await appendFriction({ cwd: run.cwd, runId: run.current().runId, step: id, friction: report.friction ?? [] });

		if (report.status === WorkReportStatus.Complete) {
			next = withStepFiles({ record, reports: [report], gitPrefix });
			await run.setStep({ record: { ...next, report }, patch: await collectChanged({ run, gitPrefix, reports: [report] }) });
		}
	}

	return formatAndVerify({ context, record: next });
};

const runCheapRepairs = async ({ context, record, result }: { context: Params; record: StepRecord; result: VerificationResult }) => {
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

const runGuidedRepair = async ({ context, record, result }: { context: Params; record: StepRecord; result: VerificationResult }) => {
	// A crashed gate buys no judgment either — the supervisor would be asked to rule on a toolchain fault. A red with no failed family
	// is that same shape: the checkpoint could not be run, so there is nothing to rule on and nothing to repair — as `runCheapRepairs` decides too.
	if (!result.error || result.failedFamilies.length === 0 || result.crashes.length > 0 || record.verification?.guidedRepairAttempted) {
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

const runVerificationStep = async ({ context }: { context: Params }) => {
	const { run, id, coverage } = context;
	const previous = run.current().steps.find((step) => step.id === id);
	let record: StepRecord = { ...run.nextRecord({ id }), ...(previous?.verification ? { verification: previous.verification } : {}) };

	await run.setStep({ record });
	run.progress(`step ${id} — attempt ${record.attempts}`);

	const initial = record.verification?.needsFormatting
		? await formatAndVerify({ context, record })
		: { record, result: await runVerificationGates({ run, coverage, checkpoint: id }) };
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

export const verifyStep = ({ run, gitPrefix, planContent, id, coverage, buildFix }: Params): PipelineStep['run'] => {
	const context: Params = { run, gitPrefix, planContent, id, coverage, buildFix };

	return () => runVerificationStep({ context });
};
