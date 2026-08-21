import type { AgentUsage, LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { maxCheapFixRetries } from '#src/refactor/batch/common/constants/maxCheapFixRetries.ts';
import { SettleKind } from '#src/refactor/batch/common/constants/SettleKind.ts';
import type { SettleOutcome } from '#src/refactor/batch/common/types/SettleOutcome.ts';
import { superviseBatch } from '#src/refactor/batch/superviseBatch.ts';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	batchId: string;
	/** The plan text (standalone banner), for the supervisor's context. */
	planContent: string;
	/** Invocations spent on the batch before this point, for the supervisor's context. */
	attempts: number;
	onProgress: (message: string) => void;
	recordUsage: (params: { step: string; usage?: AgentUsage }) => Promise<void>;
	/** One fix attempt through the caller's gate-kind routing — a red COVERAGE gate goes to the test writer, everything else back to the refactor executor. */
	invokeFix: (params: { label: string; gateError: string; guidance?: string }) => Promise<AgentOutcome<unknown>>;
	/** Run the batch's gates and return the failure output, or undefined when green. */
	gates: () => Promise<string | undefined>;
}

/**
 * Drive one batch's gates to green, or to a terminal answer.
 *
 * Two stages, cheapest first: a fixed number of mechanical fix attempts, then —
 * only if those are spent — the supervisor's exception path, which buys at most
 * one guided retry before escalating. Rate limits park at whichever stage they
 * happen in, so nothing is lost and the run resumes where it stopped.
 *
 * Separate from the batch loop because the loop's job is what to DO with the
 * answer — resolved, declined, requeued — and this is how the answer is
 * reached. The two change for different reasons.
 */
export const settleBatchGates = async ({
	cwd,
	runId,
	driver,
	config,
	batchId,
	planContent,
	attempts,
	onProgress,
	recordUsage,
	invokeFix,
	gates,
}: Params): Promise<SettleOutcome> => {
	let gateError = await gates();

	for (let retry = 1; gateError && retry <= maxCheapFixRetries; retry += 1) {
		onProgress(`${batchId}: gate red — fix attempt ${retry}/${maxCheapFixRetries}`);

		const fix = await invokeFix({ label: `fix-${retry}`, gateError });

		if (!fix.ok && fix.rateLimited) {
			return { kind: SettleKind.Parked };
		}

		gateError = await gates();
	}

	if (!gateError) {
		return { kind: SettleKind.Green };
	}

	// Exception path: mechanical retries exhausted — bring in judgment.
	return superviseBatch({
		cwd,
		runId,
		driver,
		config,
		batchId,
		planContent,
		gateError,
		attempts,
		maxCheapFixRetries,
		onProgress,
		recordUsage,
		invokeGuidedFix: ({ guidance }) => invokeFix({ label: 'supervised-fix', gateError, guidance }),
		gates,
	});
};
