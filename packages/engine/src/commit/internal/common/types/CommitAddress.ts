/** What one commit is addressed by, before the agent has said what it changes. */
export interface CommitAddress {
	/** The ticket reference the subject opens with — the ticket ref, or the run-label fallback. */
	reference: string;
	/** The caller's template subject, used whole when the agent cannot answer. */
	fallbackSubject: string;
	/** Why the work was done, handed to the agent as the reason. */
	context: string;
	/** The plan unit (`<plan-id>` or `<plan-id>/<phase-file-stem>`) named on the body's `lightsout plan` line; absent for a commit with no plan unit. */
	unit?: string;
}
