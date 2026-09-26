import { mkdir } from 'node:fs/promises';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import type { WorkOrderStateChange } from '#src/workOrder/common/types/WorkOrderStateChange.ts';
import { appendWorkOrderEvent } from '#src/workOrder/internal/common/record/appendWorkOrderEvent.ts';
import { composePlanId } from '#src/workOrder/internal/common/record/composePlanId.ts';
import { recordShipRequestWithdrawal } from '#src/workOrder/internal/common/record/recordShipRequestWithdrawal.ts';
import { requireWorkOrderState } from '#src/workOrder/internal/common/record/requireWorkOrderState.ts';
import { updateSyncedWorkOrderState } from '#src/workOrder/updateSyncedWorkOrderState.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it, and the plan folder is made here. */
	cwd: string;
	/** The work order's label, which is also the branch its plans implement on. */
	name: string;
	/** The plan slug, fixed for the life of the plan: lowercase letter-and-digit words joined by single hyphens. */
	slug: string;
	/** The plan's first display title, which stays changeable. Defaults to the slug. */
	title?: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/** What the change made, so the caller can name the plan and say why an approval lapsed. */
interface PlanAddition {
	record: WorkOrderState;
	planId: string;
	/** Whether adding this plan took a pending ship request off the ticket. */
	withdrew: boolean;
}

/** The highest number a ticket may ever allocate: a plan id carries exactly three digits. */
const maxPlanNumber = 999;

/** The next id this ticket has never held, or why the slug or the number cannot make one. */
const allocatePlanId = ({ record, slug }: { record: WorkOrderState; slug: string }): { id: string } | { error: string } => {
	const highest = record.plans.reduce((top, plan) => Math.max(top, planNumberOf({ id: plan.id })), 0);
	const next = highest + 1;

	if (next > maxPlanNumber) {
		return {
			error: `work order ${record.name} already holds plan ${String(highest).padStart(3, '0')}, and a plan's number never goes above ${maxPlanNumber} because no number is ever reused`,
		};
	}

	return composePlanId({ number: next, slug });
};

/** Everything the record must say before a plan may be added to it, and the plan added once it does. */
const addPlanToRecord = ({
	current,
	name,
	slug,
	title,
	at,
}: {
	current: WorkOrderState | undefined;
	name: string;
	slug: string;
	title: string | undefined;
	at: string;
}): PlanAddition | { error: string } => {
	if (current === undefined) {
		return {
			error: `no work order is named ${name} — create one with \`lightsout work-order new --ticket <ref>\` or \`lightsout work-order new --title <words>\` before adding a plan to it`,
		};
	}

	const existing = requireWorkOrderState({ record: current, name });

	if ('error' in existing) {
		return existing;
	}

	if (existing.mode === WorkOrderMode.SinglePlan && existing.plans.some((plan) => planNumberOf({ id: plan.id }) === 1)) {
		return {
			error: `work order ${name} is in single-plan mode, where plan 001 alone supplies the implementation — run \`lightsout work-order mode --set multiple-plan --name ${name}\` before adding a second plan`,
		};
	}

	const allocated = allocatePlanId({ record: existing, slug });

	if ('error' in allocated) {
		return allocated;
	}

	const added = appendWorkOrderEvent({
		record: { ...existing, plans: [...existing.plans, { id: allocated.id, title: title ?? slug, progress: PlanProgress.Planning, createdAt: at }] },
		kind: WorkOrderEventKind.PlanAdded,
		detail: `plan ${allocated.id} was added to work order ${name}`,
		at,
	});

	return {
		record: recordShipRequestWithdrawal({
			record: added,
			detail: `plan ${allocated.id} was added, so the ship request naming ${existing.shipRequest?.planIds.join(', ') ?? ''} no longer covers the ticket's work`,
			at,
		}),
		planId: allocated.id,
		withdrew: existing.shipRequest !== undefined,
	};
};

/**
 * Add the next plan to a work order that already exists.
 *
 * A label no record answers to is a typo rather than a way to start work: the
 * refusal names it and names `lightsout work-order new`, which is the one
 * command that writes a work order's name.
 *
 * The id is one above the highest number the ticket has ever held, excluded
 * plans counted, so a number is never reused and a ship request, an exclusion
 * or a published attachment can never come to mean a different plan. Adding a
 * plan to a multiple-plan ticket withdraws any pending ship request, because
 * the set of plans that request approved is no longer the ticket's whole work.
 *
 * The record goes first: the id is allocated under the lock that owns it, and
 * only then is the plan's own folder made. A refusal therefore leaves nothing
 * behind for the next command to trip over.
 */
export const addWorkOrderPlan = async ({
	cwd,
	name,
	slug,
	title,
	config,
	env,
	onProgress,
}: Params): Promise<(WorkOrderStateChange & { address: string }) | { error: string }> => {
	let addition: PlanAddition | undefined;
	const updated = await updateSyncedWorkOrderState({
		cwd,
		name,
		config,
		env,
		onProgress,
		change: (current) => {
			const added = addPlanToRecord({ current, name, slug, title, at: new Date().toISOString() });

			if ('error' in added) {
				return added;
			}

			addition = added;

			return added.record;
		},
	});

	if ('error' in updated) {
		return updated;
	}

	if (addition === undefined) {
		return { error: `the plan was not added to work order ${name}: the store reported no change` };
	}

	const address = formatPlanAddress({ workOrderName: name, planId: addition.planId });

	await mkdir(await planWorkspaceDir({ cwd, name: address }), { recursive: true });

	return {
		address,
		record: updated.record,
		notice: addition.withdrew
			? `the pending ship request was withdrawn because plan ${addition.planId} was added — ask again with \`lightsout work-order request-ship --name ${name}\` once the ticket's work is settled`
			: undefined,
		publishError: updated.publishError,
	};
};
