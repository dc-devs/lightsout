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
}
