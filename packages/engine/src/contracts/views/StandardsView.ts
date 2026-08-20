import { z } from 'zod';
import { StandardsFinding } from '#src/contracts/standardsCheck/index.ts';
import { StandardsRuleView } from '#src/contracts/views/StandardsRuleView.ts';
import { StandardsTrendPoint } from '#src/contracts/views/StandardsTrendPoint.ts';

/** The standards view's whole payload: the latest snapshot, every loaded rule, and the trend across snapshots. */
export const StandardsView = z.object({
	/** When the latest snapshot was taken; absent when the repo has never run a check. */
	at: z.string().optional(),
	/** Subpath the latest snapshot covered. */
	path: z.string(),
	notes: z.array(z.string()),
	findings: z.array(StandardsFinding),
	/** Every loaded rule, sorted by id — including rules with no open findings. */
	rules: z.array(StandardsRuleView),
	/** Oldest first, so a chart plots it without re-sorting. */
	trend: z.array(StandardsTrendPoint),
	/** Rule counts from the health report, plus the latest snapshot's finding counts — so no consumer ever counts for itself. */
	totals: z.object({
		rules: z.number(),
		checked: z.number(),
		judgment: z.number(),
		blocking: z.number(),
		advisory: z.number(),
		/** Findings in the latest snapshot whose `rule` matches no loaded rule — a package removed or renamed since the scan, or a rule since switched off. */
		orphans: z.number(),
	}),
});

export type StandardsView = z.infer<typeof StandardsView>;
