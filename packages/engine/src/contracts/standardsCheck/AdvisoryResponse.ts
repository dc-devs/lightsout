/**
 * What a working agent did about one advisory finding it was shown. Advice is
 * never re-checked the way a blocking site is — nothing on disk says whether it
 * was taken — so the agent's own answer is the only record there is, and it is
 * what lets the health report say how often a rule's advice is worth its noise.
 */
export const AdvisoryResponse = {
	Applied: 'applied',
	Declined: 'declined',
} as const;

export type AdvisoryResponse = (typeof AdvisoryResponse)[keyof typeof AdvisoryResponse];
