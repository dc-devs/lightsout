export const TestReviewDecision = {
	/** The change is a legitimate correction the plan's own work makes necessary. */
	Approve: 'approve',
	/** The change weakens, removes or hides a test the plan did not authorise changing. */
	Reject: 'reject',
} as const;

export type TestReviewDecision = (typeof TestReviewDecision)[keyof typeof TestReviewDecision];
