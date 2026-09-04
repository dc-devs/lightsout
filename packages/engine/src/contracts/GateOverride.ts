import { z } from 'zod';
import { uncheckpointableGateKeys } from '#src/contracts/common/constants/uncheckpointableGateKeys.ts';

/**
 * One checkpoint's entry in the `gate-overrides` block: exactly the gates that
 * checkpoint runs, in exactly that order, or the string `'off'` for no gates at
 * all.
 *
 * A list replaces the engine's own schedule entirely — no tiering, and a red
 * gate stops whatever the list ordered behind it, because the declared order is
 * the whole reason to write one. An empty list is refused rather than taken as
 * a second spelling of `'off'`: two spellings for one meaning is a question
 * every config author then has to ask. That refusal is the array branch's own
 * aborting `.min(1)` rather than a refinement, so an empty list fails both
 * branches at once and the reported error names both spellings the author could
 * have meant: the sentence below, and the `'off'` the literal branch reports it
 * expected.
 *
 * Which names a list may hold is checked where all three blocks are visible at
 * once — see `validateGateOverrideNames`, attached to `LightsoutConfig`.
 */
export const GateOverride: z.ZodType<'off' | string[]> = z
	.union([
		z.literal('off'),
		z.array(z.string()).min(1, {
			error: 'a gate-overrides list must name at least one gate — write "off" to run no gates at all at this checkpoint',
			abort: true,
		}),
	])
	.superRefine((entry, ctx) => {
		if (entry === 'off') {
			return;
		}

		for (const [name, message] of Object.entries(uncheckpointableGateKeys)) {
			if (entry.includes(name)) {
				ctx.addIssue({ code: 'custom', message });
			}
		}

		const seen = new Set<string>();
		const reported = new Set<string>();

		for (const name of entry) {
			if (seen.has(name) && !reported.has(name)) {
				reported.add(name);
				ctx.addIssue({
					code: 'custom',
					message: `gate '${name}' is named more than once in this gate-overrides list — a gate runs once per checkpoint, so a repeat is a typo`,
				});
			}

			seen.add(name);
		}
	});

export type GateOverride = z.infer<typeof GateOverride>;
