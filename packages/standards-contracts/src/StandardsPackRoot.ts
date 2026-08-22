import { z } from 'zod';

/**
 * A standards pack's root file (`lightsout-standards.json`). It carries only
 * what the folder tree cannot express — the pack's name, the format it is
 * written against, and whether it was built rather than authored. Deliberately
 * not `.strict()`: a later format version may add keys, and an unknown key is
 * never worth refusing a pack over.
 */
export const StandardsPackRoot = z.object({
	/** Names the pack in the assembled documents' header lines. */
	name: z.string().min(1),
	formatVersion: z.literal(1),
	/**
	 * Stamped by the bundler on a built pack, and absent from every authored
	 * one. Building leaves the fixture pairs and unit tests behind — they prove
	 * the pack rather than run it — so a built pack cannot answer the
	 * question `lightsout standards-validate` asks. Without this, that command
	 * reads every stripped fixture as a rule its author forgot, and reports a
	 * fault in each of them instead of one fact about the pack.
	 */
	built: z.literal(true).optional(),
});

export type StandardsPackRoot = z.infer<typeof StandardsPackRoot>;
