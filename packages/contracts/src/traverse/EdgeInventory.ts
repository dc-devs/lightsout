import { z } from 'zod';
import { EdgeOperation } from './EdgeOperation';
import { TraverseEdgeKind } from './TraverseEdgeKind';

/**
 * One scan-edges agent's inventory of a single node: every place data
 * enters or leaves the process, each with the anchor that becomes a
 * connection doc's machine-checkable freshness mechanism. The agent knows
 * nothing about other repos or the map — pairing sightings is the join's
 * job (prototype decision T8). JSON, validated at the boundary.
 */
export const EdgeInventory = z.object({
	node: z.string(),
	/** git rev-parse HEAD of the workspace at scan time. */
	scannedSha: z.string(),
	/** Last commit touching the scope (monorepo packages only) — a commit elsewhere in the monorepo doesn't invalidate this inventory. */
	scannedPathSha: z.string().nullable().default(null),
	/** Declared version of the scanner that produced this inventory — the engine stamps it; the freshness gate re-scans on a mismatch so a scanner change invalidates the cache, not only a code change. Null on legacy/unversioned inventories (→ re-scan). */
	scannerVersion: z.string().nullable().default(null),
	edges: z
		.array(
			z.object({
				direction: z.enum(['in', 'out']),
				kind: z.enum(TraverseEdgeKind).catch(TraverseEdgeKind.Other),
				/** Normalized join token: path without host/env prefixes (`/v2/event`), resolved stream name, or honest `env:VAR`. */
				matchKey: z.string(),
				/** file:line of the real emit/handler site — becomes the doc anchor. */
				at: z.string(),
				/** The greppable code fragment at that site. */
				pattern: z.string(),
				/** One line — what data crosses here. */
				payload: z.string(),
				schemaAt: z.string().nullable().default(null),
				conditional: z.string().nullable().default(null),
				/** Multiplexed transports (GraphQL, tRPC, WebSocket, webhook) carry many operations over one channel: emit ONE edge and list them here rather than one edge per operation (decision B). Empty for plain edges. */
				operations: z.array(EdgeOperation).default([]),
				/** Health checks, metrics, feature flags, third-party SaaS — flagged, never omitted; the review gate culls (T14). */
				noise: z.boolean().default(false),
			}),
		)
		.default([]),
	/** Dynamic or unresolvable edges: where, and why. */
	gaps: z.array(z.string()).default([]),
});

export type EdgeInventory = z.infer<typeof EdgeInventory>;
