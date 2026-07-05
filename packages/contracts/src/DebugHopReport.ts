import { z } from 'zod';

/**
 * One debug-hop agent's structured verdict on a single node: given the
 * symptoms, the current hypothesis, and the prior evidence, did the root
 * cause surface HERE — and if not, which single lead does the evidence point
 * to next. The debug counterpart to HopReport: same anchor-drift discipline
 * and gaps-not-guesses, but the job is root-cause-or-continue, not
 * trace-and-report-exits. JSON, validated at the boundary; enum-ish fields
 * `.catch(...)` so a novel value degrades instead of sinking the report.
 */
export const DebugHopReport = z.object({
	node: z.string(),
	anchorCheck: z.object({
		status: z.enum(['ok', 'drifted', 'missing']).catch('ok'),
		/** file:line where the anchor actually was, when drifted. */
		foundAt: z.string().nullable().default(null),
	}),
	/** What was examined here and what was found — the local investigation, 1–4 sentences. */
	investigation: z.string(),
	/** root-cause: the defect is here. points-elsewhere: not here, follow the lead. stuck: can't localize and no lead. */
	verdict: z.enum(['root-cause', 'points-elsewhere', 'stuck']).catch('stuck'),
	/** Set only when verdict = root-cause: where the defect is and why it produces the symptoms. */
	rootCause: z.object({ at: z.string(), explanation: z.string() }).nullable().default(null),
	/** Set only when verdict = root-cause: the proposed fix, concrete enough to act on. */
	proposedFix: z.string().nullable().default(null),
	/** Set only when verdict = points-elsewhere: the single strongest lead to follow next. */
	nextLead: z
		.object({
			/** The node to hop to. */
			node: z.string(),
			/** Which way the evidence points along the connecting edge. */
			direction: z.enum(['upstream', 'downstream']).catch('downstream'),
			/** What to look for at that node — the refined hypothesis carried forward. */
			refinedHypothesis: z.string(),
			/** The evidence for this lead (e.g. "the input was already null on arrival"). */
			why: z.string(),
		})
		.nullable()
		.default(null),
	/** Anything the agent could not determine, and why — never a guess. */
	gaps: z.array(z.string()).default([]),
	confidence: z.enum(['solid', 'partial', 'dead-end']).catch('partial'),
});

export type DebugHopReport = z.infer<typeof DebugHopReport>;
