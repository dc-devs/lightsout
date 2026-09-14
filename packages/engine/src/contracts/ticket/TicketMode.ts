/**
 * How one ticket's plans are organised, saved on the ticket's own record.
 *
 * `SinglePlan` means plan 001 alone supplies the ticket's implementation — that
 * one plan may still have phases — and the repository's automatic shipping
 * applies exactly as it did before ticket records existed. `MultiplePlan` means
 * the ticket's plans implement in numeric order on one branch and the ticket
 * ships only when an explicit ship request naming the included plans is
 * satisfied.
 *
 * A ticket's mode is seeded from `plan.default-ticket-mode` when its record is
 * created and is that ticket's own saved choice from then on.
 */
export const TicketMode = {
	SinglePlan: 'single-plan',
	MultiplePlan: 'multiple-plan',
} as const;

export type TicketMode = (typeof TicketMode)[keyof typeof TicketMode];
