/**
 * What one worker invocation amounted to, with every worker's different report
 * shape already normalized: a question to relay, an error to park on, a reason
 * the ticket stays open, or none of them — which is success.
 */
export interface WorkerOutcome {
	question?: string;
	error?: string;
	/** True when the error is a question nobody answered — the one park that says the human is away. */
	unanswered?: boolean;
	/** Why the ticket stays open: the worker built everything it could and the ticket's record does not authorize shipping it. Never set beside `question` or `error`. */
	open?: string;
}
