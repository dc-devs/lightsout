import { z } from 'zod';

/**
 * The optional `plan` block of `lightsout.config.json` — whether this
 * repository's plans are written as contracts with an acceptance-test ledger,
 * and the counts above which one plan file is heavy enough to earn the reader
 * fan-out.
 *
 * Every key is off by default, so an absent block is exactly the behaviour
 * every plan command had before this key existed: the same template, the same
 * required sections, the reader fleet on every plan file. Turning `contract` on
 * is a repository saying its plans carry the tests that state their acceptance
 * criteria, so grading may be mostly mechanical.
 *
 * `.strict()` for the same reason `ConfigShip` is strict: the rest of the config
 * strips unknown keys, and a typo in an opt-in switch has to fail loudly rather
 * than silently leave the feature off.
 */
export const ConfigPlan = z
	.object({
		/** When true the writer produces the contract shape with an acceptance-test ledger, the lint requires the ledger section, and the grade weighs each plan file and spawns readers only for heavy ones. Default false: every plan command behaves exactly as before this key existed. */
		contract: z.boolean().optional(),
		/** The counts above which a plan file is heavy. Each key optional; see `defaultWeightThresholds`. */
		'weight-thresholds': z
			.object({
				/** A file creating more source files than this is heavy. Default 3. */
				'created-files': z.number().int().min(0).optional(),
				/** A file touching more packages than this is heavy. Default 1. */
				packages: z.number().int().min(1).optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

export type ConfigPlan = z.infer<typeof ConfigPlan>;
