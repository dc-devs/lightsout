/** Timestamp expiry enables recovery; only the fenced state is terminal. */
export const PlanningLeaseStatus = { Active: 'active', Fenced: 'fenced' } as const;
export type PlanningLeaseStatus = (typeof PlanningLeaseStatus)[keyof typeof PlanningLeaseStatus];
