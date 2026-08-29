/** Which worker a route label sends a ticket to — the queue's whole routing vocabulary. */
export const QueueRoute = {
	/** Build straight from the ticket body; the repo's gates are the only bar. */
	Direct: 'direct',
	/** Plan the ticket headlessly with the auto-plan skill, then implement the plan. */
	AutoPlan: 'auto-plan',
} as const;

export type QueueRoute = (typeof QueueRoute)[keyof typeof QueueRoute];
