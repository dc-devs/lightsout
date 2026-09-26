import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import type { WorkOrderStateChange } from '#src/workOrder/common/types/WorkOrderStateChange.ts';
import { appendWorkOrderEvent } from '#src/workOrder/internal/common/record/appendWorkOrderEvent.ts';
import { changeExistingWorkOrderState } from '#src/workOrder/internal/common/record/changeExistingWorkOrderState.ts';
import { resolveWorkOrderPlan } from '#src/workOrder/internal/common/record/resolveWorkOrderPlan.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The work order's label, which is also the branch its plans implement on. */
	name: string;
	/** A full plan id, or the plan's number on its own. */
	plan: string;
	title: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/**
 * Change what a plan is called, and nothing else.
 *
 * The id, the plan's folder, its published attachments and any pending ship
 * request are all left exactly as they were — that separation is the whole
 * point of a plan having a mutable title beside a fixed identity, and it is
 * what makes renaming a plan something that never withdraws an approval.
 */
export const retitleWorkOrderPlan = ({ cwd, name, plan, title, config, env, onProgress }: Params): Promise<WorkOrderStateChange | { error: string }> =>
	changeExistingWorkOrderState({
		cwd,
		name,
		config,
		env,
		onProgress,
		change: (record) => {
			if (title.trim() === '') {
				return { error: `a plan's display title is what a human recognises it by, so it cannot be blank` };
			}

			const target = resolveWorkOrderPlan({ record, token: plan });

			if ('error' in target) {
				return target;
			}

			return appendWorkOrderEvent({
				record: { ...record, plans: record.plans.map((candidate) => (candidate.id === target.id ? { ...candidate, title } : candidate)) },
				kind: WorkOrderEventKind.PlanRetitled,
				detail: `plan ${target.id} on work order ${name} is now titled '${title}'`,
				at: new Date().toISOString(),
			});
		},
	});
