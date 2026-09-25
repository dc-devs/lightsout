import { commitRunWork } from '#src/commit/commitRunWork.ts';
import type { RunState } from '#src/common/services/RunState.ts';
import { headingOf } from '#src/common/utils/headingOf.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { nextStepRecord } from '#src/direct/internal/common/utils/nextStepRecord.ts';
import { stopDirectRun } from '#src/direct/internal/common/utils/stopDirectRun.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';

interface Params {
	run: RunState;
	/** The harness the direct pipeline holds — handed to the commit step for the commit-message agent. */
	driver: Driver;
	/** The run's label, which prefixes the commit subject. */
	ticketRef: string;
	/** The frozen ticket body: the reason handed to the commit-message agent, and its first heading completes the fallback subject. */
	ticketBody: string;
	/** Whether this run adopted an existing manifest rather than minting one — forwarded to the commit step, which compares the tree for unowned edits only on a resume. */
	resumed: boolean;
}

/**
 * How a direct run ends: its commit, and the stamp or the stop that follows.
 *
 * Both of the run's endings come here — a first run whose gates went green, and
 * a run re-entered with its gates already recorded green — so the two cannot
 * end differently. The commit is made while the run is still running, because a
 * run already stamped passed could not be failed by the commit that follows it.
 *
 * A refused commit is recorded under a step of its own rather than over the
 * gate step, so the gates that did pass keep saying so and a resume pays for
 * the commit alone.
 */
export const finishDirectRun = async ({ run, driver, ticketRef, ticketBody, resumed }: Params): Promise<PipelineResult> => {
	const address = { reference: ticketRef, fallbackSubject: `${ticketRef} ${headingOf({ text: ticketBody })}`.trim(), context: ticketBody };
	const uncommitted = await commitRunWork({ run, driver, address, resumed });

	if (uncommitted !== undefined) {
		return stopDirectRun({ run, record: nextStepRecord({ run, id: 'commit' }), status: RunStatus.Failed, error: uncommitted });
	}

	await run.update({ patch: { status: RunStatus.Passed, currentStep: null } });

	const passed: PipelineResult = { ok: true, manifest: run.current() };

	return passed;
};
