import { z } from 'zod';
import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { PlanId } from '#src/contracts/workOrder/PlanId.ts';
import { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';

const WorkOrderStateShape = z
	.object({
		schemaVersion: z.literal(1),
		/** The ticket this record belongs to, as the tracker names it — `LO-140`. */
		ticketRef: z.string().min(1),
		/** The one branch every plan of this ticket implements on, which is also the ticket folder's name. */
		branch: z.string().min(1),
		mode: z.enum(WorkOrderMode),
		/** Every plan the ticket has ever held, excluded ones included, in ascending number order. */
		plans: z.array(WorkOrderPlan),
		/** The human's explicit request to ship, bound to the exact plans it was approved for. */
		shipRequest: z
			.object({ planIds: z.array(PlanId).min(1), requestedAt: z.string() })
			.strict()
			.optional(),
		/** What actually shipped. A record carrying it is history: nothing changes it again. */
		shipped: z
			.object({ at: z.string(), planIds: z.array(PlanId), mergeCommit: z.string() })
			.strict()
			.optional(),
		history: z.array(z.object({ at: z.string(), kind: z.enum(WorkOrderEventKind), detail: z.string() }).strict()),
	})
	.strict();

/** Two plans sharing a number, or listed out of order, would make 'the lowest plan that is not implemented' ambiguous. */
const checkPlanOrder = ({ record, ctx }: { record: z.infer<typeof WorkOrderStateShape>; ctx: z.RefinementCtx }) => {
	const numbers = record.plans.map((plan) => planNumberOf({ id: plan.id }));

	for (const [index, number] of numbers.entries()) {
		const previous = numbers[index - 1];

		if (previous !== undefined && !(previous < number)) {
			ctx.addIssue({
				code: 'custom',
				message: `plan ${record.plans[index]?.id} does not come after plan ${record.plans[index - 1]?.id} — a ticket's plans are held in ascending number order and no number is ever reused`,
			});
		}
	}
};

/** A request naming a plan the ticket does not hold, or naming one twice, cannot describe a set of plans to ship. */
const checkShipRequest = ({ record, ctx }: { record: z.infer<typeof WorkOrderStateShape>; ctx: z.RefinementCtx }) => {
	const held = new Set(record.plans.map((plan) => plan.id));
	const named = new Set<string>();

	for (const planId of record.shipRequest?.planIds ?? []) {
		if (!held.has(planId)) {
			ctx.addIssue({ code: 'custom', message: `the ship request names plan ${planId}, which this ticket does not hold` });
		}

		if (named.has(planId)) {
			ctx.addIssue({ code: 'custom', message: `the ship request names plan ${planId} more than once` });
		}

		named.add(planId);
	}
};

/**
 * A ticket's own record: `ticket.json`, held exactly once per machine, in the
 * ticket folder of the PRIMARY checkout's plans directory.
 *
 * It lives in the primary checkout for the reason `WorktreeRecord` does: the
 * mode, each plan's progress and the ship request are mutable state that the
 * planning tree, the implementation tree, the queue's tree and the primary
 * checkout all read, and one copy per machine is what stops them disagreeing.
 * Only the ticket module's store writes it, and `history` is append-only — a
 * change that drops or rewrites an earlier event is refused rather than
 * written.
 *
 * A plan folder with no such record is a legacy folder and keeps behaving
 * exactly as it did before ticket records existed.
 */
export const WorkOrderState = WorkOrderStateShape.superRefine((record, ctx) => {
	checkPlanOrder({ record, ctx });
	checkShipRequest({ record, ctx });
});

export type WorkOrderState = z.infer<typeof WorkOrderState>;
