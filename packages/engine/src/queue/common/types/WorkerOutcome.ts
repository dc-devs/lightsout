/**
 * What one worker invocation amounted to, with every worker's different report
 * shape already normalized: a question to relay, an error to park on, or
 * neither — which is success.
 */
export interface WorkerOutcome {
	question?: string;
	error?: string;
	/** True when the error is a question nobody answered — the one park that says the human is away. */
	unanswered?: boolean;
}
