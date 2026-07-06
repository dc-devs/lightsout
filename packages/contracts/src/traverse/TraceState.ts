import { z } from 'zod';
import { HopReport } from './HopReport';
import { TraverseEdgeKind } from './TraverseEdgeKind';

/**
 * The traversal's entire loop state, rewritten to disk after every hop so a
 * run is resumable and auditable (prototype decisions T7/T13): frontier +
 * visited set + budget is recursion flattened into a worklist — the visited
 * set is what terminates cycles, the budget is what bounds cost, and the
 * ordered hops ARE the trace artifact every output mode renders from (T10).
 */
export const TraceState = z.object({
	question: z.string(),
	dataOfInterest: z.string(),
	budget: z.object({
		maxHops: z.number().int().positive(),
		used: z.number().int().nonnegative(),
	}),
	/** Edge ids waiting to be traversed (queue), each with the routing reason. */
	frontier: z.array(z.object({ edge: z.string(), reason: z.string() })),
	/** Edge ids already traversed — never re-enqueued (cycle safety). */
	visited: z.array(z.string()),
	/** Ordered hop records. `report` absent = a non-repo node crossed mechanically. */
	hops: z.array(
		z.object({
			edge: z.string(),
			node: z.string(),
			report: HopReport.optional(),
			note: z.string().optional(),
		}),
	),
	/** Unmapped or ambiguous exits — boundaries, never license to guess (T7). */
	gaps: z.array(
		z.object({
			node: z.string(),
			detail: z.string(),
			exit: z
				.object({
					kind: z.enum(TraverseEdgeKind),
					target: z.string(),
					at: z.string(),
					carries: z.string(),
				})
				.optional(),
		}),
	),
	/** Anchor mismatches hop agents reported — each one names the doc to repair. */
	drift: z.array(
		z.object({
			edge: z.string(),
			node: z.string(),
			status: z.enum(['drifted', 'missing']),
			foundAt: z.string().nullable(),
		}),
	),
	answer: z.string().nullable(),
});

export type TraceState = z.infer<typeof TraceState>;
