/**
 * Which drafting implementation produced a plan.
 *
 * It lives in the contracts layer rather than beside the draft flow because
 * `PlanningStepRecord` is a zod schema that references it, and a constant the
 * contracts layer could not import would force that record to spell the two
 * strings a second time.
 */
export const DraftImplementation = {
	Focused: 'focused',
	Legacy: 'legacy',
} as const;

export type DraftImplementation = (typeof DraftImplementation)[keyof typeof DraftImplementation];
