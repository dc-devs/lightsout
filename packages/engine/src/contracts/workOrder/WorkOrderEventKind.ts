/**
 * What one entry of a ticket record's append-only history records.
 *
 * The history is what makes a withdrawal or a supersession readable after the
 * fact: a ship request that a newly added plan withdrew leaves both the
 * `ShipRequested` and the `ShipRequestWithdrawn` event, rather than one silent
 * replacement.
 *
 * `PlanAdopted` records that a plan's files came from a source folder rather
 * than the plan being created empty. Its key and its value are both fixed: the
 * history is parsed with a strict enum, so changing either would make a record
 * already published to a ticket unreadable.
 */
export const WorkOrderEventKind = {
	PlanAdded: 'plan-added',
	PlanAdopted: 'plan-adopted',
	PlanRetitled: 'plan-retitled',
	PlanExcluded: 'plan-excluded',
	ModeChanged: 'mode-changed',
	ShipRequested: 'ship-requested',
	ShipRequestWithdrawn: 'ship-request-withdrawn',
	Shipped: 'shipped',
} as const;

export type WorkOrderEventKind = (typeof WorkOrderEventKind)[keyof typeof WorkOrderEventKind];
