/**
 * What one worker invocation amounted to, with the two routes' different report
 * shapes already normalized: a question to relay, an error to park on, or
 * neither — which is success.
 */
export interface WorkerOutcome {
	question?: string;
	error?: string;
}
