/** Proposal placement changes approval timing, never semantic completion requirements. */
export const PlanningProposalPosition = { BeforeDraft: 'before-draft', AfterReady: 'after-ready' } as const;
export type PlanningProposalPosition = (typeof PlanningProposalPosition)[keyof typeof PlanningProposalPosition];
