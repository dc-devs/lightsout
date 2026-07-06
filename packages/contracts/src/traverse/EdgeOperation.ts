import { z } from 'zod';

/**
 * One logical operation carried by a MULTIPLEXED edge — a GraphQL
 * query/mutation, a tRPC procedure, a WebSocket event, a webhook action.
 * Such transports are one physical channel (a single endpoint/socket/topic)
 * carrying many operations, so the edge pairs at the transport level and the
 * operations ride along as its payload — the map stays at connection
 * altitude without a doc per operation (decision B, 2026-07-05). No anchor
 * per operation by design: the edge is verified at the transport, not
 * operation by operation.
 */
export const EdgeOperation = z.object({
	name: z.string(),
	/** query | mutation | subscription | event | null — transport-specific, freeform for generality across GraphQL/tRPC/WebSocket/webhook. */
	type: z.string().nullable().default(null),
});

export type EdgeOperation = z.infer<typeof EdgeOperation>;
