import { z } from 'zod';
import { EdgeOperation } from './EdgeOperation';
import { TraverseEdgeKind } from './TraverseEdgeKind';

const anchor = z.object({
	/** Repo-root-relative, whichever form the node takes. */
	path: z.string(),
	/** Greppable pattern at that path — the machine-checkable freshness mechanism (prototype decision T2). */
	pattern: z.string(),
});

/**
 * One connection doc's frontmatter — a router, not documentation (prototype
 * decision T1): `from`/`to` follow the DATA (not the request — responses are
 * edges, T6), anchors make freshness machine-checkable, and real
 * documentation stays in the repos behind `additional-context`. Raw keys are
 * the authored kebab-case; the transform yields the camelCase shape code
 * consumes.
 */
export const ConnectionDoc = z
	.object({
		from: z.string(),
		to: z.string(),
		type: z.enum(TraverseEdgeKind),
		'from-anchor': anchor.optional(),
		'to-anchor': anchor.optional(),
		schema: z.object({ from: z.string().optional(), to: z.string().optional() }).optional(),
		'last-verified-sha': z.record(z.string(), z.string().nullable()).optional(),
		'additional-context': z.array(z.string()).optional(),
		/** Operations carried by a multiplexed edge (GraphQL/tRPC/WebSocket/webhook) — generated evidence, verified at the transport not per-operation (decision B). Absent for plain edges. */
		operations: z.array(EdgeOperation).optional(),
	})
	.transform((raw) => ({
		from: raw.from,
		to: raw.to,
		type: raw.type,
		fromAnchor: raw['from-anchor'],
		toAnchor: raw['to-anchor'],
		schema: raw.schema,
		lastVerifiedSha: raw['last-verified-sha'],
		additionalContext: raw['additional-context'] ?? [],
		operations: raw.operations ?? [],
	}));

export type ConnectionDoc = z.infer<typeof ConnectionDoc>;
