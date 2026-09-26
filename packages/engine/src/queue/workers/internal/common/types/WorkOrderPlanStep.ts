import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

/** Everything one turn of a work order's ordered plan build needs, carried as one value so each step of it takes the same argument. */
export interface WorkOrderPlanStep {
	/** The work order's worktree: where the plan is restored, built and committed. */
	cwd: string;
	/** The work order's record as this turn of the loop read it. */
	record: WorkOrderState;
	/** The plan this turn is on. */
	plan: WorkOrderPlan;
	ticket: TicketSummary;
	config: LightsoutConfig;
	/** The process environment the tracker credentials are read from. */
	env: NodeJS.ProcessEnv;
	driver: Driver;
	/** Recorded as the harness name on a build from the ticket body. */
	driverName: string;
	/** The ticket's directory under the coordinator run, where the commit message file is written. */
	workOrderRunDir: string;
	onProgress?: (message: string) => void;
}
