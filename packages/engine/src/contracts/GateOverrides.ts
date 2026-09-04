import { z } from 'zod';
import { GateOverride } from '#src/contracts/GateOverride.ts';

/**
 * The optional `gate-overrides` block of `lightsout.config.json` — which gates
 * run at each of the four verification checkpoints.
 *
 * A listed checkpoint runs exactly the gates its entry names, in that order,
 * with no tiering; `"off"` runs none at all. An unlisted checkpoint keeps the
 * engine's default: the cheap gates first, and the expensive ones only once
 * every package group's cheap gates are green.
 *
 * `.strict()` for the same reason `ConfigAutoPlan` is strict: the rest of the
 * config strips unknown keys, and a misspelled checkpoint has to fail loudly
 * rather than silently disable a schedule the author believes is set.
 */
export const GateOverrides = z
	.object({
		/** The baseline gate run, before any agent works — the codebase must already be green. */
		'clean-slate': GateOverride.optional(),
		/** The gate run after the feature executor's implementation. */
		'verify-implement': GateOverride.optional(),
		/** The gate run after the tests are written. */
		'verify-tests': GateOverride.optional(),
		/** The gate run after the refactor pass. */
		'verify-refactor': GateOverride.optional(),
	})
	.strict();

export type GateOverrides = z.infer<typeof GateOverrides>;
