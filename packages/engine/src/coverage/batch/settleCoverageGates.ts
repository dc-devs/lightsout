import { maxCheapFixRetries } from '#src/common/constants/maxCheapFixRetries.ts';
import { CoverageBatchStopKind } from '#src/coverage/common/constants/CoverageBatchStopKind.ts';
import type { CoverageBatchStop } from '#src/coverage/common/types/CoverageBatchStop.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';

interface Params {
	batchId: string;
	onProgress: (message: string) => void;
	/** One fix attempt, carrying the gate output that sent the work back. */
	invokeFix: (params: { label: string; errorContext: string }) => Promise<AgentOutcome<unknown>>;
	/** The tests-only verdict on what the batch has written — the error message, or undefined when only tests changed. */
	testsOnly: () => Promise<string | undefined>;
	/** Run the batch's gates and answer their whole verdict — a red, a crash, or a run that never started. */
	gates: () => Promise<GateRunResult>;
}

/**
 * The stop a gate run that never started settles by itself: escalated rather
 * than failed, because a batch nobody could verify is a human's call rather than
 * a batch that was judged and lost.
 */
const coordinationStop = ({ result }: { result: GateRunResult }): CoverageBatchStop | undefined =>
	result.coordination === undefined ? undefined : { kind: CoverageBatchStopKind.Escalated, error: result.coordination };

/**
 * Drive one coverage batch's gates to green, or to the condition that stopped
 * it: a rate limit, a source file a fix agent reached for, or a gate still red
 * once the mechanical attempts are spent. Undefined means green.
 *
 * There is no supervisor stage here, unlike the refactor batch's settler: a
 * coverage batch that cannot be made green is set aside for a human with the
 * gate output attached, and the run continues on the next batch.
 *
 * A gate run that never started — the machine was held by another run of this
 * repository — ends the settle at once, whether it is the first call or a re-run
 * inside the loop, and spends no fix invocation on it: no gate command executed,
 * so there is nothing about the batch to repair.
 *
 * Separate from the batch loop because the loop's job is what to DO with a
 * verified tree — measure it, classify it — and this is how the tree comes to
 * be verified. The two change for different reasons.
 */
export const settleCoverageGates = async ({ batchId, onProgress, invokeFix, testsOnly, gates }: Params): Promise<CoverageBatchStop | undefined> => {
	let result = await gates();
	let stop: CoverageBatchStop | undefined = coordinationStop({ result });

	for (let retry = 1; result.error && stop === undefined && retry <= maxCheapFixRetries; retry += 1) {
		onProgress(`${batchId}: gate red — fix attempt ${retry}/${maxCheapFixRetries}`);

		const fix = await invokeFix({ label: `fix-${retry}`, errorContext: result.error });

		if (!fix.ok && fix.rateLimited) {
			stop = { kind: CoverageBatchStopKind.Parked };
		} else {
			const violation = await testsOnly();

			if (violation) {
				stop = { kind: CoverageBatchStopKind.Failed, error: violation };
			} else {
				result = await gates();
				stop = coordinationStop({ result });
			}
		}
	}

	if (stop === undefined && result.error) {
		stop = { kind: CoverageBatchStopKind.Failed, error: `${batchId}: gates still red after ${maxCheapFixRetries} fix attempt(s)\n${result.error}` };
	}

	return stop;
};
