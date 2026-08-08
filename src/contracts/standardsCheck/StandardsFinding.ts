import { z } from 'zod';
import { StandardsRule } from '@/contracts/standardsCheck/StandardsRule';
import { StandardsSeverity } from '@/contracts/standardsCheck/StandardsSeverity';

/**
 * One structural defect found by `lightsout standards-check`. Typed because
 * this is v2's remediation work-list: a refactor agent gets handed a grouped
 * set of findings, never "go find problems".
 */
export const StandardsFinding = z.object({
	rule: z.enum(StandardsRule),
	/**
	 * Only the two reporting severities. `off` is a CONFIGURATION state — a
	 * rule a repo switched off emits nothing, so a persisted finding at
	 * severity `off` would be a contradiction the schema should refuse.
	 */
	severity: z.enum([StandardsSeverity.Blocking, StandardsSeverity.Advisory]),
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

export type StandardsFinding = z.infer<typeof StandardsFinding>;
