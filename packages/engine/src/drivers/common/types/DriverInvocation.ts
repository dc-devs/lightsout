import type { Effort, Permissions } from '@/contracts';

export interface DriverInvocation {
	/** Full user-message prompt, assembled deterministically by the engine (plan, standards, task). */
	prompt: string;
	/** Agent role instructions (e.g. the feature-executor prompt). Mapped to the harness's system-prompt mechanism. */
	systemPrompt?: string;
	/** Model override, passed through to the harness. Omit to use the harness default. */
	model?: string;
	/** Reasoning effort, mapped to the harness's own effort flag. Omit to take the harness default. */
	effort?: Effort;
	/** Working directory of the target repository. */
	cwd: string;
	/**
	 * Harness-neutral capability level, translated by each driver. Headless runs
	 * cannot prompt a human — the engine must pre-declare policy per role.
	 * `read-only` is engine-selected for the supervisor; config offers only
	 * `write` and `full-access`.
	 */
	permissions?: Permissions;
	/**
	 * Consumer-granted shell command prefixes (config `agentCommands`), mapped
	 * to the harness's allowed-tools mechanism. Additive only: it can open
	 * these commands where the user's harness settings are strict, never close
	 * anything their settings already allow — the binding grant the agent is
	 * told to honor lives in the invocation prompt.
	 */
	allowedCommands?: string[];
	/** Kill the harness process after this many ms. The driver rejects; the engine decides what a hang means. */
	timeoutMs?: number;
	/**
	 * Called once per harness event as it streams (tool calls, token ticks,
	 * the final result), each the raw parsed JSON. Drivers with no event
	 * stream never call it — the engine must not depend on it for outcomes.
	 */
	onEvent?: (event: unknown) => void;
}
