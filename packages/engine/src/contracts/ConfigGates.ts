import { z } from 'zod';
import { baseGateShape } from '@/contracts/common/constants/baseGateShape';
import { validateCustomTestGates } from '@/contracts/common/utils/validateCustomTestGates';

/** The fixed gate keys — everything else in the block must be a custom `test-*` suite. */
const knownGateKeys = new Set(['check', 'test', 'test-coverage', 'testCoverage', 'testUnit', 'generate', 'build', 'format']);

/**
 * Verification commands — the mechanical gates. Full shell commands, run by
 * the engine itself; agents never run them.
 *
 * `test` and `test-coverage` are two spellings of the same suite — plain and
 * coverage-instrumented — so the engine runs one or the other, never both.
 * Every other `test-*` key is a custom suite of its own (`test-e2e`,
 * `test-integration`, …), run in the order written here, after the unit suite
 * and before `build`. The key set is otherwise closed: an unknown key that is
 * not a `test-*` suite fails parsing, because a silently dropped gate is a
 * suite that never runs.
 *
 * Validation only — the parsed value keeps the config's own spelling, so a
 * run manifest's config snapshot round-trips through this schema unchanged.
 * `resolveGates` is where the engine reads the block.
 */
export const ConfigGates = z
	.object({
		...baseGateShape,
		/**
		 * Coverage gate — on by default. Required: either a full shell command
		 * (run at clean-slate and every post-test verify) or the literal
		 * `false` to explicitly opt out. Silence is not an option: skipping
		 * the strongest gate must be a decision, not an accident. The command
		 * must run the same suite `test` runs, instrumented — the engine
		 * substitutes it for `test`, never runs both.
		 */
		'test-coverage': z.union([z.string(), z.literal(false)]),
		/**
		 * Opt-in codegen, run once BEFORE every gate set (not inside check:
		 * gates verify, generate mutates). Red exit fails the gate set.
		 */
		generate: z.string().optional(),
		/** Opt-in build gate, run last in every verify. Omit when nothing compiles. */
		build: z.string().optional(),
		/** Opt-in formatter, run once at the very end of the pipeline (gates re-verify after). */
		format: z.string().optional(),
	})
	.catchall(z.unknown())
	.superRefine((gates, ctx) => {
		validateCustomTestGates({
			gates,
			knownGateKeys,
			ctx,
			unknownKeyMessage: ({ key }) => `unknown gate '${key}' — gates are check, test, test-coverage, generate, build, format, or a custom \`test-*\` suite`,
		});
	});

export type ConfigGates = z.infer<typeof ConfigGates>;
