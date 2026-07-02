export interface DriverInvocation {
	/** Full user-message prompt, assembled deterministically by the engine (plan, standards, task). */
	prompt: string;
	/** Agent role instructions (e.g. the feature-executor prompt). Mapped to the harness's system-prompt mechanism. */
	systemPrompt?: string;
	/** Model override, passed through to the harness. Omit to use the harness default. */
	model?: string;
	/** Working directory of the target repository. */
	cwd: string;
	/** Harness permission mode (e.g. 'acceptEdits'). Headless runs cannot prompt a human — the engine must pre-declare policy per role. */
	permissionMode?: string;
	/** Kill the harness process after this many ms. The driver rejects; the engine decides what a hang means. */
	timeoutMs?: number;
}
