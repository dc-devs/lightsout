import { RunStatus, type StepRecord, WorkReportStatus } from '#src/contracts/index.ts';
import { collectChanged } from '#src/pipeline/common/utils/collectChanged.ts';
import { withStepFiles } from '#src/pipeline/common/utils/withStepFiles.ts';
import type { RepairOutcome } from '#src/pipeline/steps/verifyStep/common/types/RepairOutcome.ts';
import type { VerifyContext } from '#src/pipeline/steps/verifyStep/common/types/VerifyContext.ts';
import { formatAndVerify } from '#src/pipeline/steps/verifyStep/common/utils/formatAndVerify.ts';
import { appendFriction } from '#src/runState/index.ts';

interface Params {
	context: VerifyContext;
	/** The gate output the fix role has to repair. */
	errorContext: string;
	record: StepRecord;
}

/**
 * One turn of the checkpoint's fix role: invoke it with the error it has to
 * repair, record what it changed, then format and re-run the gates on the tree
 * it left behind.
 */
export const runFix = async ({ context, errorContext, record }: Params): Promise<RepairOutcome> => {
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
