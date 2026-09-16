import { z } from 'zod';
import { PlanningDigest, PlanningVocabulary } from '#src/contracts/plan/workflow/index.ts';
import { AgentUsage } from '#src/contracts/run/AgentUsage.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';

/**
 * What a reader can say about a plan whose state lives in the canonical
 * planning store rather than in `planning-progress.json`.
 *
 * It is a projection, never a second journal: every field is derived on read
 * from the verified generation, the local call records beside it and the run
 * manifests, and nothing here is written back to disk. Canonical work is named
 * by the record's own ids and roles rather than squeezed into the five fixed
 * planning steps, because the work a plan does is decided per plan.
 *
 * Detail the records do not hold is absent, and every reader of this projection
 * must say so rather than filling it in: an absent `usage.totals` means nothing
 * reported what planning cost, and an absent `implementation` means this repo
 * holds no implement run for the plan — neither is a zero and neither is a pass.
 */
export const PlanningCanonicalProgress = z.object({
	/** The verified generation the projection was read from. */
	generation: PlanningDigest,
	/** One entry per durable work item, in record order. */
	work: z.array(
		z
			.object({
				/** The record's own work id. */
				id: z.string().min(1),
				role: z.enum(PlanningVocabulary.Role),
				/** The work state in the progress vocabulary: pending, running, passed for complete, failed for an attempt that stopped short. */
				status: z.enum(RunStatus),
				attempts: z.number().int().nonnegative(),
			})
			.strict(),
	),
	/** One line per blocking finding still open — what actually holds readiness back. */
	blockers: z.array(z.string().min(1)),
	/** Saved conclusions a later role can reuse, and findings an independent reviewer verified as repaired. Absent when the record holds neither. */
	reuse: z.object({ savedConclusions: z.number().int().positive(), repairedFindings: z.number().int().nonnegative() }).strict().optional(),
	/** Recorded planning calls, deduplicated by call id. */
	usage: z
		.object({
			/** Distinct calls the store recorded. */
			calls: z.number().int().nonnegative(),
			/** How many of those reported no usage at all — their spend is unknown rather than zero. */
			unreported: z.number().int().nonnegative(),
			/** Summed over the calls that did report; absent when none did. */
			totals: AgentUsage.optional(),
		})
		.strict(),
	/** The implement run this repo holds for the plan, latest first write wins. Absent when there is none — which is not a failure and not a pass. */
	implementation: z
		.object({ runId: z.string().min(1), status: z.enum(RunStatus) })
		.strict()
		.optional(),
});

export type PlanningCanonicalProgress = z.infer<typeof PlanningCanonicalProgress>;
