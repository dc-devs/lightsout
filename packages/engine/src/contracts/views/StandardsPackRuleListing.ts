import { StandardsSet } from '@lightsout/standards-contracts';
import { z } from 'zod';
import { StandardsSeverity } from '#src/contracts/standardsCheck/index.ts';

/**
 * One rule as a pack's page lists it — everything except the text that makes a
 * payload heavy.
 *
 * Deliberately not `StandardsRuleView`: that row is about how one repo runs a
 * rule — the severity its config chose, how many findings are open, what
 * refactor history recorded — and this one is about what the rule *is*, which is
 * the same on every machine.
 */
export const StandardsPackRuleListing = z.object({
	id: z.string(),
	set: z.enum(StandardsSet),
	/** Pack-relative document folder path, e.g. 'code/style-guide/patterns/functions'. */
	documentPath: z.string(),
	summary: z.string(),
	/** 'base' unless the owning document declares a channel. */
	channel: z.string(),
	checked: z.boolean(),
	defaultSeverity: z.enum([StandardsSeverity.Blocking, StandardsSeverity.Advisory]),
	defaultSettings: z.record(z.string(), z.number()),
	/** How many files each fixture side holds; both zero for a built pack. */
	fixtureCounts: z.object({ pass: z.number(), fail: z.number() }),
});

export type StandardsPackRuleListing = z.infer<typeof StandardsPackRuleListing>;
