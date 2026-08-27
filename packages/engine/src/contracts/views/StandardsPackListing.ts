import { z } from 'zod';

/** One pack as the packs page lists it: identity, counts, no rules. */
export const StandardsPackListing = z.object({
	name: z.string(),
	description: z.string().optional(),
	homepage: z.string().optional(),
	/** True for the pack a run loads when the config names none. */
	isDefault: z.boolean(),
	/** Absolute folder the pack was read from. */
	rootPath: z.string(),
	/**
	 * `rootPath` relative to the repo the view was built for, or absolute when it
	 * lies outside it — what a `standards-packs` entry would say. Computed in the
	 * engine view; a browser component cannot.
	 */
	path: z.string(),
	/** Stripped of its fixtures by the bundler — every rule's fixture counts are zero. */
	built: z.boolean(),
	/** Distinct channels across the pack's documents, sorted. */
	channels: z.array(z.string()),
	totals: z.object({
		rules: z.number(),
		checked: z.number(),
		judgment: z.number(),
		documents: z.number(),
		/** Rules with at least one pass and one fail fixture file. */
		withFixtures: z.number(),
	}),
});

export type StandardsPackListing = z.infer<typeof StandardsPackListing>;
