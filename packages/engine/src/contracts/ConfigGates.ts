import { z } from 'zod';

/**
 * Verification commands — the mechanical gates. Full shell commands, run by
 * the engine itself; agents never run them.
 */
export const ConfigGates = z.object({
	check: z.string(),
	test: z.string(),
	/** Removed — renamed to `test`. Declared only so a stale key fails loudly instead of being silently stripped. */
	testUnit: z.never('`testUnit` was renamed to `test`').optional(),
	/**
	 * Coverage gate — on by default. Required: either a full shell command
	 * (run at clean-slate and every post-test verify) or the literal
	 * `false` to explicitly opt out. Silence is not an option: skipping
	 * the strongest gate must be a decision, not an accident.
	 */
	testCoverage: z.union([z.string(), z.literal(false)]),
	/**
	 * Opt-in codegen, run once BEFORE every gate set (not inside check:
	 * gates verify, generate mutates). Red exit fails the gate set.
	 */
	generate: z.string().optional(),
	/** Opt-in build gate, run last in every verify. Omit when nothing compiles. */
	build: z.string().optional(),
	/** Opt-in formatter, run once at the very end of the pipeline (gates re-verify after). */
	format: z.string().optional(),
});

export type ConfigGates = z.infer<typeof ConfigGates>;
