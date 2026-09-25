import type { HarnessProcessUsage } from '#src/contracts/activity/HarnessProcessUsage.ts';
import type { Effort } from '#src/contracts/Effort.ts';
import type { Permissions } from '#src/contracts/Permissions.ts';
import type { AgentEnvironment } from '#src/drivers/common/types/AgentEnvironment.ts';

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
	 * Consumer-granted shell command prefixes (config `agent-commands`), mapped
	 * to the harness's allowed-tools mechanism. Additive only: it can open
	 * these commands where the user's harness settings are strict, never close
	 * anything their settings already allow — the binding grant the agent is
	 * told to honor lives in the invocation prompt.
	 */
	allowedCommands?: string[];
	/**
	 * A focused role's requested agent environment, translated by each driver.
	 * Omitted by every ordinary invocation — an invocation without it produces
	 * byte-identical argv to one built before this member existed.
	 */
	environment?: AgentEnvironment;
	/** Kill the harness process after this many ms. The driver rejects; the engine decides what a hang means. */
	timeoutMs?: number;
	/**
	 * Called once per harness event as it streams (tool calls, token ticks,
	 * the final result), each the raw parsed JSON. Drivers with no event
	 * stream never call it — the engine must not depend on it for outcomes.
	 */
	onEvent?: (event: unknown) => void;
	/**
	 * Called whenever this process's stream reports fresh usage, each payload
	 * the running total so far. Drivers that cannot read usage mid-stream never
	 * call it — a process that reported nothing is then recorded as having
	 * reported nothing, never as zero.
	 */
	onUsage?: (usage: HarnessProcessUsage) => void;
}
