import { z } from 'zod';

/**
 * What a pack's check emits: everything about one defect except which rule
 * found it and how loudly to say so. Both of those are the engine's to say — the
 * rule id comes from the folder the check was loaded from, and the severity from
 * the rule's front matter under any config override. A check that could name
 * them itself could also name them wrong.
 *
 * This is the base shape, and `StandardsFinding` is derived from it by adding
 * those two fields. The dependency runs that way round because this is the half
 * a standards pack implements: a pack author writes checks against this file
 * and needs nothing else the engine knows. Deriving it the other way — by
 * subtracting from the engine's persisted shape — would make every standards
 * pack depend on the engine's storage format to describe its own output.
 *
 * The two shapes still cannot drift, because the shared fields are stated once
 * here and reused there.
 */
export const RawStandardsFinding = z.object({
	/** Grouping key — findings sharing a site key are one remediation unit, and it is the identity the debt ledger records. */
	siteKey: z.string(),
	files: z.array(
		z.object({
			path: z.string(),
			startLine: z.number().optional(),
			endLine: z.number().optional(),
		}),
	),
	/** What is true of this one site — the measurement, the names, the span. */
	detail: z.string(),
	/**
	 * What to do about findings of this kind, and any judgment the rule
	 * cannot make for itself. Constant across every finding a rule emits for
	 * the same reason, so a reader is told once rather than once per site.
	 */
	guidance: z.string().optional(),
});

export type RawStandardsFinding = z.infer<typeof RawStandardsFinding>;
