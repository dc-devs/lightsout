import type { LightsoutConfig } from '#src/contracts/index.ts';
import { changeExistingWorkOrderState } from '#src/workOrder/common/record/changeExistingWorkOrderState.ts';
import { recordShipRequestWithdrawal } from '#src/workOrder/common/record/recordShipRequestWithdrawal.ts';
import type { WorkOrderStateChange } from '#src/workOrder/common/types/WorkOrderStateChange.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The work order's label, which is also the branch its plans implement on. */
	name: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/**
 * Take a pending ship request back off a ticket.
 *
 * The withdrawal is recorded rather than the field simply cleared, so the
 * request that was made stays readable beside it — which is what lets a later
 * reader see that a finish line was declared and then taken back, rather than
 * that one was never declared at all.
 */
export const withdrawWorkOrderShipRequest = ({ cwd, name, config, env, onProgress }: Params): Promise<WorkOrderStateChange | { error: string }> =>
	changeExistingWorkOrderState({
		cwd,
		name,
		config,
		env,
		onProgress,
		change: (record) =>
			record.shipRequest === undefined
				? { error: `work order ${name} carries no ship request, so there is nothing to withdraw` }
				: recordShipRequestWithdrawal({
						record,
						detail: `the request to ship ${record.shipRequest.planIds.join(', ')} was withdrawn by hand`,
						at: new Date().toISOString(),
					}),
	});
