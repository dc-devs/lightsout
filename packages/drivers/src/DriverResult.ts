export interface DriverResult {
	/** The agent's final text. The engine validates it against the step's zod contract — never trusts it raw. */
	text: string;
	/** Harness process exit code. */
	exitCode: number;
	/**
	 * Best-effort signal that the harness hit its subscription rate limit.
	 * Heuristic (error output pattern match) — the engine treats it as a
	 * pausable state, so a false negative degrades to a normal failure.
	 */
	rateLimited?: boolean;
	/** Token/cost usage from the harness's result envelope, normalized. Omitted by drivers that report nothing. */
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheCreationTokens: number;
		costUsd: number;
	};
}
