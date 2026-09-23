import { z } from 'zod';
import { PlanId } from '#src/contracts/workOrder/PlanId.ts';

/** A SHA-256 digest as this sidecar spells one: 64 lowercase hex characters. */
const sha256Digest = z.string().regex(/^[a-f0-9]{64}$/, 'a hash is written as 64 lowercase hex characters');

/**
 * What this machine last published or restored, written beside `state.json` in
 * the work order's own folder under the primary checkout as `state-sync.json`.
 *
 * It is the base of the three-way comparison the pull makes: with it, a local
 * state file and a published one that differ can be told apart into "only we
 * moved", "only the ticket moved" and "both moved". Without it two differing
 * copies are a divergence, which is the safe direction.
 *
 * It is never published — it describes this machine's own history with the
 * ticket, not the ticket — and only the work order module reads or writes it.
 */
export const WorkOrderSyncState = z
	.object({
		schemaVersion: z.literal(1),
		/** SHA-256 of the `serializeWorkOrderState` bytes last published or restored. Absent before the first sync. */
		recordSha256: sha256Digest.optional(),
		/** Per plan id, the SHA-256 of the plan's commit marker as this machine last published or restored it. */
		planMarkers: z.record(PlanId, sha256Digest),
	})
	.strict();

export type WorkOrderSyncState = z.infer<typeof WorkOrderSyncState>;
