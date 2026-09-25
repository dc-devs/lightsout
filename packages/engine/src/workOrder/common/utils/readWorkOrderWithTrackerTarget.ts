import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { TicketTrackerTarget } from '#src/workOrder/common/types/TicketTrackerTarget.ts';
import { resolveWorkOrderTrackerTarget } from '#src/workOrder/common/utils/resolveWorkOrderTrackerTarget.ts';
import { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';

interface Params {
	/** The checkout the record is read from — any one, since the primary is resolved inside. */
	cwd: string;
	/** The work order's label. */
	name: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
}

/**
 * This machine's copy of a work order's record, and where that record
 * publishes to.
 *
 * The record is read before the tracker is resolved, because the record is the
 * only thing that says which ticket this work order belongs to. Every operation
 * that reaches the tracker on a work order's behalf begins this way, so the
 * order is stated once here rather than being repeated — and repeated
 * correctly — at each of them.
 *
 * `localOnly` is handed back on the target rather than answered here, because
 * what a work order with nowhere to publish means differs at every call site:
 * a pull answers the local record, a sync refuses, and a plan publish refuses
 * naming the plan.
 */
export const readWorkOrderWithTrackerTarget = async ({
	cwd,
	name,
	config,
	env,
}: Params): Promise<{ record: WorkOrderState | undefined; target: TicketTrackerTarget | { localOnly: string } } | { error: string }> => {
	const held = await readWorkOrderState({ cwd, name });

	if ('error' in held) {
		return held;
	}

	const target = resolveWorkOrderTrackerTarget({ config, env, workOrderName: name, ticketRef: held.record?.ticketRef });

	return 'error' in target ? target : { record: held.record, target };
};
