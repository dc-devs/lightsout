import { z } from 'zod';

/**
 * A standards package's root file (`lightsout-standards.json`). It carries only
 * what the folder tree cannot express — the package's name and the format it is
 * written against. Deliberately not `.strict()`: a later format version may add
 * keys, and an unknown key is never worth refusing a package over.
 */
export const StandardsPackageRoot = z.object({
	/** Names the package in the assembled documents' header lines. */
	name: z.string().min(1),
	formatVersion: z.literal(1),
});

export type StandardsPackageRoot = z.infer<typeof StandardsPackageRoot>;
