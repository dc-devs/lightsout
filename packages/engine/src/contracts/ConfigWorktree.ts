import { z } from 'zod';

/**
 * The optional `worktree` block of `lightsout.config.json` — the shared
 * workspace-preparation settings, read by everything that creates a worktree.
 *
 * Top-level rather than nested under `queue` or `implement` because both run the
 * same command: the queue prepares a tree per ticket, and an isolated
 * implementation run prepares one per run. A key living inside either block
 * would read as belonging to that one alone.
 *
 * `.strict()` for the same reason `ConfigPlan` is strict: the rest of the config
 * strips unknown keys, and a typo in an opt-in setting has to fail loudly rather
 * than silently leave the default in force.
 */
export const ConfigWorktree = z
	.object({
		/** Command run once in a fresh worktree before any agent, e.g. `pnpm install`. Absent means nothing runs. */
		setup: z.string().optional(),
	})
	.strict();

export type ConfigWorktree = z.infer<typeof ConfigWorktree>;
