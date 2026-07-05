import { z } from 'zod';
import { DebugHopReport } from './DebugHopReport';

/** A lead the loop hasn't investigated yet, or already has: a node reached via an edge, in a direction, with the hypothesis to carry in. */
const direction = z.enum(['upstream', 'downstream', 'seed']).catch('downstream');

/**
 * A debug run's entire loop state, rewritten to disk after every hop so the
 * run is resumable and auditable — the debug counterpart to TraceState. The
 * frontier + visited set + budget is recursion flattened into a worklist:
 * `visited` (keyed `node+direction`, since a bidirectional walk can approach
 * an edge from either end) terminates cycles, `budget` bounds cost, and a
 * root-cause verdict sets `resolution` and halts the loop. Deliberately NOT
 * unified with TraceState — debug is a different walk (own report, own
 * frontier shape, own halt); unify only if a second reason appears.
 */
export const DebugTraceState = z.object({
	/** The user's bug description — symptoms x/y/z (+ any suspect commit / date context). */
	symptoms: z.string(),
	/** The current working hypothesis, refined hop to hop; starts from the symptoms. */
	hypothesis: z.string(),
	budget: z.object({
		maxHops: z.number().int().positive(),
		used: z.number().int().nonnegative(),
	}),
	/** Leads waiting to be investigated (queue): a node + direction + the hypothesis to carry in. */
	frontier: z.array(
		z.object({
			node: z.string(),
			/** The connecting edge id, or null for the seed (no incoming edge). */
			viaEdge: z.string().nullable().default(null),
			direction,
			hypothesis: z.string(),
			reason: z.string(),
		}),
	),
	/** `node+direction` keys already investigated — never re-enqueued (cycle safety). */
	visited: z.array(z.string()),
	/** Ordered hop records. `report` absent = a non-repo node crossed mechanically. */
	hops: z.array(
		z.object({
			node: z.string(),
			viaEdge: z.string().nullable().default(null),
			direction,
			report: DebugHopReport.optional(),
			note: z.string().optional(),
		}),
	),
	/** Cold trails and unmapped/ambiguous leads — boundaries, never license to guess. */
	gaps: z.array(z.object({ node: z.string(), detail: z.string() })),
	/** Anchor mismatches hop agents reported — each names a doc to repair. */
	drift: z.array(
		z.object({
			node: z.string(),
			viaEdge: z.string().nullable(),
			status: z.enum(['drifted', 'missing']),
			foundAt: z.string().nullable(),
		}),
	),
	/** The halt slot: set when a hop returns verdict = root-cause. Null while unresolved. */
	resolution: z.object({ node: z.string(), at: z.string(), explanation: z.string(), proposedFix: z.string() }).nullable(),
});

export type DebugTraceState = z.infer<typeof DebugTraceState>;
