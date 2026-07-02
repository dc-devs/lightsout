export interface DriverInvocation {
	/** Full user-message prompt, assembled deterministically by the engine (plan, standards, task). */
	prompt: string;
	/** Agent role instructions (e.g. the feature-executor prompt). Mapped to the harness's system-prompt mechanism. */
	systemPrompt?: string;
	/** Model override, passed through to the harness. Omit to use the harness default. */
	model?: string;
	/** Working directory of the target repository. */
	cwd: string;
}
