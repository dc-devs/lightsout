import { z } from 'zod';

/**
 * The optional top-level `pricing` block of `lightsout.config.json` — published
 * rates, keyed by the model identifier a harness was invoked with.
 *
 * It buys one thing: a separate, clearly labelled estimated-cost column in
 * `lightsout report`. It is read there and nowhere else — no writer, no
 * manifest snapshot and no activity record ever consults it, and nothing
 * computed from it is stored, so the saved record stays a statement of what a
 * harness itself reported.
 *
 * There is no default. A repository that configures no rates loses that one
 * column and keeps every other figure, because a rate nobody stated cannot be
 * guessed at.
 *
 * One rate per token count `HarnessProcessUsage` carries, so no rate can be
 * applied to a count it does not match, and each is US dollars per million
 * tokens — the unit every harness vendor publishes, so a user copies the
 * published number rather than converting it.
 *
 * Each entry is `.strict()` for the same reason `ConfigPlan` and `ConfigShip`
 * are: the rest of the config strips unknown keys, and a typo in a rate name
 * would then leave that token count silently unpriced while the column still
 * printed a total. It has to fail loudly instead.
 */
export const ConfigPricing = z.record(
	z.string(),
	z
		.object({
			/** US dollars per million input tokens. */
			input: z.number().nonnegative(),
			/** US dollars per million output tokens. */
			output: z.number().nonnegative(),
			/** US dollars per million tokens read from the prompt cache. */
			'cache-read': z.number().nonnegative(),
			/** US dollars per million tokens written to the prompt cache. */
			'cache-write': z.number().nonnegative(),
		})
		.strict(),
);

export type ConfigPricing = z.infer<typeof ConfigPricing>;
