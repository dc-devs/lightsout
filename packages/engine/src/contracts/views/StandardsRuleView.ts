import { StandardsSet } from '@lightsout/standards-contracts';
import { z } from 'zod';
import { StandardsSeverity } from '#src/contracts/standardsCheck/index.ts';

/**
 * One rule as a reader shows it: what the rule says, how this repo runs it, how
 * many findings it has open, and what refactor history recorded about it.
 *
 * Composed from the rule listing and the health report rather than replacing
 * either — the two answer different questions about the same rule, and a reader
 * wants both on one row.
 */
export const StandardsRuleView = z.object({
	rule: z.string(),
	/** '<package name>: <document folder>' — which package states the rule, and where. */
	doc: z.string(),
	/** Package-relative document folder, for linking. */
	documentPath: z.string(),
	set: z.enum(StandardsSet),
	summary: z.string(),
	/** The rule.md body — its full prose argument. */
	prose: z.string(),
	checked: z.boolean(),
	severity: z.enum([StandardsSeverity.Blocking, StandardsSeverity.Advisory, StandardsSeverity.Off]),
	/** True when this repo's config set the severity or the settings. */
	fromConfig: z.boolean(),
	settings: z.record(z.string(), z.number()),
	/** Open findings for this rule in the latest snapshot. */
	findingCount: z.number(),
	history: z.object({
		attempted: z.number(),
		resolved: z.number(),
		declined: z.number(),
		untracked: z.number(),
		adviceApplied: z.number(),
		adviceDeclined: z.number(),
		adviceAlreadyMet: z.number(),
		reasons: z.array(z.string()),
	}),
});

export type StandardsRuleView = z.infer<typeof StandardsRuleView>;
