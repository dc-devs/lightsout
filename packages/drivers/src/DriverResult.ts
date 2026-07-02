export interface DriverResult {
	/** The agent's final text. The engine validates it against the step's zod contract — never trusts it raw. */
	text: string;
	/** Harness process exit code. */
	exitCode: number;
}
