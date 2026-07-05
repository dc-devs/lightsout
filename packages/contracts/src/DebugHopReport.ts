import { z } from 'zod';
import { TraverseEdgeKind } from './TraverseEdgeKind';

/**
 * One debug-hop agent's structured verdict on a single node: given the
 * symptoms, the current hypothesis, and the prior evidence, did the root
 * cause surface HERE — and if not, which single lead does the evidence point
 * to next. The debug counterpart to HopReport: same anchor-drift discipline
 * and gaps-not-guesses, but the job is root-cause-or-continue, not
 * trace-and-report-exits. JSON, validated at the boundary; enum-ish fields
 * `.catch(...)` so a novel value degrades instead of sinking the report, and
 * a `.refine` binds each verdict to the fields it must carry so a malformed
 * report is re-emitted, never read past.
 */
export const DebugHopReport = z
	.object({
		node: z.string(),
		/** Entry-anchor verification — omitted on the SEED hop, which has no entry anchor (it investigates the whole node for the symptoms). */
		anchorCheck: z
			.object({
				status: z.enum(['ok', 'drifted', 'missing']).catch('ok'),
				/** file:line where the anchor actually was, when drifted. */
				foundAt: z.string().nullable().default(null),
			})
			.optional(),
		/** What was examined here and what was found — the local investigation, 1–4 sentences. */
		investigation: z.string(),
		/** root-cause: the defect is here. points-elsewhere: not here, follow the lead. stuck: can't localize and no lead. */
		verdict: z.enum(['root-cause', 'points-elsewhere', 'stuck']).catch('stuck'),
		/** Set only when verdict = root-cause: where the defect is and why it produces the symptoms. */
		rootCause: z.object({ at: z.string(), explanation: z.string() }).nullable().default(null),
		/** Set only when verdict = root-cause: the proposed fix, concrete enough to act on. */
		proposedFix: z.string().nullable().default(null),
		/** Set only when verdict = points-elsewhere: the single strongest lead to follow next. Describes the CROSSING seen in this node's code (kind + target + at) and the direction — the engine routes it to the adjacent node/edge, because the agent is map-blind (one-repo rule). downstream = an outbound crossing (data leaves here); upstream = the inbound crossing the bad data arrived through. */
		nextLead: z
			.object({
				/** downstream (outbound crossing → its receiver) or upstream (inbound crossing → its sender). */
				direction: z.enum(['upstream', 'downstream']).catch('downstream'),
				/** The crossing's kind (http, message-bus, …) as seen in this node's code. */
				kind: z.enum(TraverseEdgeKind).catch(TraverseEdgeKind.Other),
				/** URL pattern / stream name / channel of the crossing. */
				target: z.string(),
				/** file:line of the crossing in this node. */
				at: z.string(),
				/** What to look for at the far side — the refined hypothesis carried forward. */
				refinedHypothesis: z.string(),
				/** The evidence for this lead (e.g. "the input was already null on arrival"). */
				why: z.string(),
			})
			.nullable()
			.default(null),
		/** Anything the agent could not determine, and why — never a guess. */
		gaps: z.array(z.string()).default([]),
		confidence: z.enum(['solid', 'partial', 'dead-end']).catch('partial'),
	})
	.refine(
		(report) => {
			if (report.verdict === 'root-cause') {
				return report.rootCause !== null && report.proposedFix !== null;
			}

			if (report.verdict === 'points-elsewhere') {
				return report.nextLead !== null;
			}

			return true;
		},
		{ message: "verdict 'root-cause' needs rootCause + proposedFix; 'points-elsewhere' needs nextLead" },
	);

export type DebugHopReport = z.infer<typeof DebugHopReport>;
