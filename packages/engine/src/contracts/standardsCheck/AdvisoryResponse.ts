/**
 * What a working agent did about one advisory finding it was shown. Advice is
 * never re-checked the way a blocking site is — nothing on disk says whether it
 * was taken — so the agent's own answer is the only record there is, and it is
 * what lets the health report say how often a rule's advice is worth its noise.
 *
 * `already-met` exists because the other two both lie about that case. An agent
 * that finds the advice's end-state already true made no edit, so `applied`
 * claims work it did not do; and the file does not need the change, so
 * `declined` says the advice was rejected. In a live run an agent picked
 * `applied` and said so in its own summary:
 *
 *   "I reported them as 'applied' since the required end-state holds, but the
 *    account is ambiguous — the schema has no outcome for 'already compliant,
 *    no edit made this pass', and 'declined' would falsely imply the file lacks
 *    the fix."
 *
 * It reads as advice taken, which inflates exactly the number the health report
 * exists to measure. Older reports carry only the first two values and still
 * parse.
 */
export const AdvisoryResponse = {
	Applied: 'applied',
	Declined: 'declined',
	/** The end-state the advice asks for was already true — nothing to do, and nothing rejected. */
	AlreadyMet: 'already-met',
} as const;

export type AdvisoryResponse = (typeof AdvisoryResponse)[keyof typeof AdvisoryResponse];
