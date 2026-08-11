export const SupervisorDecision = {
	/** The failure is mechanically fixable — re-invoke the working role with the supervisor's guidance. */
	Retry: 'retry',
	/** A human decision is required — park the run as escalated with the diagnosis. */
	Escalate: 'escalate',
} as const;

export type SupervisorDecision = (typeof SupervisorDecision)[keyof typeof SupervisorDecision];
