import { z } from 'zod';
import { PlanId } from '#src/contracts/ticket/PlanId.ts';
import { PlanProgress } from '#src/contracts/ticket/PlanProgress.ts';

/** A SHA-256 digest as this record spells one: 64 lowercase hex characters. */
const sha256Digest = z.string().regex(/^[0-9a-f]{64}$/, 'a hash is written as 64 lowercase hex characters');

/**
 * One plan's entry in its ticket's record.
 *
 * Every object here is `.strict()`. The record travels between machines through
 * the tracker, and a reader that quietly stripped a field a newer engine wrote
 * would then write the record back without it; failing the parse loudly is the
 * only outcome that cannot lose another machine's state.
 */
export const TicketPlan = z
	.object({
		id: PlanId,
		/** The plan's mutable display title. Changing it never changes the plan's identity, its folder or a pending ship request. */
		title: z.string().min(1),
		progress: z.enum(PlanProgress),
		/** ISO timestamp of the moment the plan was added or adopted. */
		createdAt: z.string(),
		/** The implementation run recorded against this plan — the latest one, replaced when the plan is implemented again after a repair. */
		implementation: z
			.object({
				runId: z.string(),
				startedAt: z.string(),
				/** The ticket branch's HEAD when the run started. */
				startCommit: z.string(),
				finishedAt: z.string().optional(),
				/** The plan's durable files as the passed run left them, so a later change to them is detectable. */
				snapshot: z.array(z.object({ name: z.string(), sha256: sha256Digest }).strict()).optional(),
			})
			.strict()
			.optional(),
		/** The SHA-256 of the plan's attachment marker as this plan was last published, which is what makes a divergent published copy detectable. */
		publishedMarker: sha256Digest.optional(),
		/** The recorded decision that takes this plan out of the ticket's implementation order and its shipping requirements. Final, and never a progress value. */
		exclusion: z
			.object({
				at: z.string(),
				reason: z.string().min(1),
				/** Whether the human declared this plan's implementation removed from the branch. */
				implementationRemoved: z.boolean(),
				/** The commit the repository's own gates passed on when the removal was verified. */
				verifiedCommit: z.string().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

export type TicketPlan = z.infer<typeof TicketPlan>;
