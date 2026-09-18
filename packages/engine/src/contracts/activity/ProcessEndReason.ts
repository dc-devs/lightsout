/**
 * How one harness process ended.
 *
 * A closed set rather than free text, for the same reason every other
 * end-reason in the engine is one: a report line, a filter and a test all
 * narrow on it. Every member is something the writer can prove at the moment
 * the spawn settles, which is the rule the set is chosen by.
 *
 * There is deliberately no `rejected`. Whether an answer satisfied its contract
 * is judged after the process has ended, by the code holding the contract
 * rather than by the code writing the mark, so a writer could only guess at it.
 * Nothing is lost: a request the engine re-ran reads as several rows already,
 * and a row carrying the re-emit flag says the row above it was the answer
 * thrown away.
 */
export const ProcessEndReason = {
	/** The process returned a result. Whether that result then satisfied its contract is not this field's business. */
	Completed: 'completed',
	/** The result said the harness had met its subscription rate-limit wall. */
	RateLimited: 'rate-limited',
	/** The spawn rejected at the ceiling it was given — killed, never returned. */
	TimedOut: 'timed-out',
	/** The spawn rejected for any other reason: the spawn itself failed, or the process ended some other way that produced no result. */
	Failed: 'failed',
} as const;

export type ProcessEndReason = (typeof ProcessEndReason)[keyof typeof ProcessEndReason];
