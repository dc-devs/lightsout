import { z } from 'zod';
import { EdgeOperation } from './EdgeOperation';
import { TraverseEdgeKind } from './TraverseEdgeKind';

const sighting = z.object({
	at: z.string(),
	pattern: z.string(),
	payload: z.string(),
	schemaAt: z.string().nullable().default(null),
});

/**
 * The mechanical join over pooled edge inventories — deterministic string
 * work, never agent judgment (prototype decision T8). Persisted as
 * join.json: the REVIEW GATE artifact. The user culls entries (delete a
 * matched edge, reject a fuzzy pair) before the author step reads it back —
 * no connection doc is ever written from an unreviewed join (T14).
 */
export const MapJoin = z.object({
	/** New edges, both sides sighted in code — ready to author. */
	matched: z.array(
		z.object({
			from: z.string(),
			to: z.string(),
			kind: z.enum(TraverseEdgeKind),
			matchKey: z.string(),
			fromSighting: sighting,
			toSighting: sighting,
			/** Operations carried by a multiplexed edge — those sighted on BOTH sides (caller invokes AND handler exposes = verified traffic; decision B). Empty for plain single-operation edges. */
			operations: z.array(EdgeOperation).default([]),
			/** Operation-level drift for a multiplexed edge: `callerOnly` — invoked but not exposed by the handler (likely renamed/removed); `handlerOnlyCount` — exposed but never called (unused surface). */
			operationDrift: z
				.object({ callerOnly: z.array(z.string()).default([]), handlerOnlyCount: z.number().default(0) })
				.default({ callerOnly: [], handlerOnlyCount: 0 }),
			/** Matched only under tolerant normalization (slashes, param forms, version prefixes) — review these hardest. */
			fuzzy: z.boolean(),
		}),
	),
	/** Existing docs whose anchors both check out against fresh sightings → update last-verified-sha. */
	confirmed: z.array(z.object({ doc: z.string() })),
	/** Existing docs a sighting disagrees with → repair candidates. */
	drifted: z.array(
		z.object({
			doc: z.string(),
			side: z.enum(['from', 'to']),
			foundAt: z.string(),
			pattern: z.string(),
		}),
	),
	/** Outbound with no inbound match: receiver unscanned, external, or AWS. */
	orphansOut: z.array(z.object({ node: z.string(), kind: z.enum(TraverseEdgeKind), matchKey: z.string(), at: z.string(), payload: z.string() })),
	/** Inbound with no outbound match: sender unscanned, or a dead endpoint. */
	orphansIn: z.array(z.object({ node: z.string(), kind: z.enum(TraverseEdgeKind), matchKey: z.string(), at: z.string(), payload: z.string() })),
	/** Everything the scanners flagged — culled by review, never silently dropped. */
	noise: z.array(z.object({ node: z.string(), direction: z.enum(['in', 'out']), kind: z.enum(TraverseEdgeKind), matchKey: z.string(), at: z.string() })),
	/** Scanner gaps, surfaced per node. */
	gaps: z.array(z.object({ node: z.string(), detail: z.string() })),
});

export type MapJoin = z.infer<typeof MapJoin>;
