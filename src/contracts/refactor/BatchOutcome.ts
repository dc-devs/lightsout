/**
 * How a refactor batch ended. `Declined` is an honest, recorded judgment —
 * the agent reported complete with no changes while clusters persist (the
 * scanner cannot hear judgment); it never fails the run by itself.
 */
export const BatchOutcome = {
	Resolved: 'resolved',
	Declined: 'declined',
} as const;

export type BatchOutcome = (typeof BatchOutcome)[keyof typeof BatchOutcome];
