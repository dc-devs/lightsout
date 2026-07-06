export const RunStatus = {
	Pending: 'pending',
	Running: 'running',
	Passed: 'passed',
	Failed: 'failed',
	/** Hit the harness rate-limit wall — a first-class pausable state, not an error. Resumes when the window resets. */
	PausedRateLimit: 'paused-rate-limit',
	/** Supervisor determined a human decision is required. */
	Escalated: 'escalated',
} as const;

export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];
