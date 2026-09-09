import { z } from 'zod';

/**
 * The optional `implement` block of `lightsout.config.json` — the settings the
 * `implement` command itself reads, of which the cleanup round budget is the
 * only one so far.
 *
 * Not to be confused with `commands.implement`, which picks a harness for this
 * command and lives in a different block. This one is the command's own
 * behaviour.
 *
 * `.strict()` for the same reason `ConfigPlan` is strict: the rest of the config
 * strips unknown keys, and a typo in an opt-in setting has to fail loudly rather
 * than silently leave the default in force.
 */
export const ConfigImplement = z
	.object({
		/** Implementation cleanup — the bounded, non-blocking tidying pass that ends a run's implementation. */
		refactor: z
			.object({
				/** How many cleanup executor rounds one run may spend at most. Default 2 (`defaultRefactorMaxRounds`). A whole count of invocations, so a fraction is refused; zero is refused too, because turning cleanup off is what the skip control does. */
				'max-rounds': z.number().int().positive().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

export type ConfigImplement = z.infer<typeof ConfigImplement>;
