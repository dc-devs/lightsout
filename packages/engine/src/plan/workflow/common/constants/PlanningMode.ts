/** Interaction policy changes escalation, never the standard of completion. */
export const PlanningMode = { Interactive: 'interactive', Automatic: 'automatic' } as const;
export type PlanningMode = (typeof PlanningMode)[keyof typeof PlanningMode];
