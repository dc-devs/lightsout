import { z } from 'zod';

/**
 * A standards package's root file (`lightsout-standards.json`). It carries only
 * what the folder tree cannot express — the package's name, the format it is
 * written against, and whether it was built rather than authored. Deliberately
 * not `.strict()`: a later format version may add keys, and an unknown key is
 * never worth refusing a package over.
 */
export const StandardsPackageRoot = z.object({
	/** Names the package in the assembled documents' header lines. */
	name: z.string().min(1),
	formatVersion: z.literal(1),
	/**
	 * Stamped by the bundler on a built package, and absent from every authored
	 * one. Building leaves the fixture pairs and unit tests behind — they prove
	 * the package rather than run it — so a built package cannot answer the
	 * question `lightsout standards-validate` asks. Without this, that command
	 * reads every stripped fixture as a rule its author forgot, and reports a
	 * fault in each of them instead of one fact about the package.
	 */
	built: z.literal(true).optional(),
});

export type StandardsPackageRoot = z.infer<typeof StandardsPackageRoot>;
