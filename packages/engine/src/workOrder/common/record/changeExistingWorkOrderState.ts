import type { LightsoutConfig, WorkOrderState } from '#src/contracts/index.ts';
import { requireWorkOrderState } from '#src/workOrder/common/record/requireWorkOrderState.ts';
import type { WorkOrderStateChange } from '#src/workOrder/common/types/WorkOrderStateChange.ts';
import { updateSyncedWorkOrderState } from '#src/workOrder/updateSyncedWorkOrderState.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The work order's label, which is also the branch its plans implement on. */
	name: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
	/** The operation's own rules, run against the record the pull settled on — a ticket with no record, and one that has shipped, never reach it. */
	change: (record: WorkOrderState) => WorkOrderState | { error: string };
}

/**
 * Every change an operation makes to a ticket that already has a record: pull,
 * apply, publish.
 *
 * The two refusals every record-changing subcommand owes — no record at all,
 * and a record that has shipped — are answered here rather than by each
 * operation, so an operation states only its own rules and cannot forget one of
 * the shared pair. The change runs inside the store's callback against the
 * record the pull settled on, which is what makes a refusal leave the record's
 * bytes untouched.
 */
export const changeExistingWorkOrderState = async ({
	cwd,
	name,
	config,
	env,
	onProgress,
	change,
}: Params): Promise<WorkOrderStateChange | { error: string }> => {
	const updated = await updateSyncedWorkOrderState({
		cwd,
		name,
		config,
		env,
		onProgress,
		change: (current) => {
			const record = requireWorkOrderState({ record: current, name });

			return 'error' in record ? record : change(record);
		},
	});

	return 'error' in updated ? updated : { record: updated.record, publishError: updated.publishError };
};
