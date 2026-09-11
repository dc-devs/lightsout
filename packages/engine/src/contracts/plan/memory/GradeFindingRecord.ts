import { z } from 'zod';
import { GapArea } from '#src/contracts/plan/grade/GapArea.ts';
import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import { GapObservation } from '#src/contracts/plan/grade/GapObservation.ts';
import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
import { GradeFindingStatus } from '#src/contracts/plan/memory/GradeFindingStatus.ts';

/**
 * One judged finding as the plan's memory keeps it: what was asked, who settled
 * it, and every state change since.
 *
 * The identity half mirrors `GradedGap`, because a record IS a gap the memory
 * carried across passes. What it adds is provenance a single pass cannot hold —
 * when the question was first raised, the judge outcome that created it, the
 * citations that closed it, and every time a later pass reopened it.
 *
 * The top-level `phase`, `lens`, `area`, `gap`, `decision` and `options` are the
 * record's representative; `observations` holds every reader's own report of the
 * defect once a judge confirms several described one.
 */
export const GradeFindingRecord = z.object({
	/** `f<N>`, assigned in creation order and never reused. */
	id: z.string(),
	/** The plan file's basename, the same label `GradedGap.phase` carries. */
	phase: z.string(),
	lens: z.enum(GapCheckLens).optional(),
	area: z.enum(GapArea),
	gap: z.string(),
	decision: z.string(),
	options: z.array(z.string()).default([]),
	/** Every original observation the record holds, each with its own phase, lens and wording. Empty on a record written before grouping existed — read it through `recordObservations`. */
	observations: z.array(GapObservation).default([]),
	firstSeen: z.string(),
	lastSeen: z.string(),
	status: z.enum(GradeFindingStatus),
	/**
	 * The judge outcome that settled the record, kept verbatim and never rewritten
	 * once written. Absent only on a `pending` record, which no judge has ruled on;
	 * `unjudged` is excluded because it is the engine's stamp, not a ruling.
	 */
	disposition: z.enum([GapOutcome.NeedsAHuman, GapOutcome.AgentCanDecide, GapOutcome.AlreadyAnswered]).optional(),
	/** Why nobody settled a `pending` record, so the blocker it surfaces as can say what went wrong. */
	unjudgedReason: z.string().optional(),
	/** The confirmed group's shared-defect statement, kept verbatim and never rewritten. */
	sharedDefect: z.string().optional(),
	/** Set only on a `superseded` record: the id of the record that now carries its obligation. Never cleared, so the trail stays readable. */
	supersededBy: z.string().optional(),
	humanDecision: z.string().optional(),
	agentDecision: z.string().optional(),
	safeBecause: z.string().optional(),
	answerAt: z.string().optional(),
	/** The single-location closure written before per-location resolutions existed. Read only through `recordResolutions`; nothing writes it again. */
	resolution: z.object({ answerAt: z.string(), verifiedAt: z.string() }).optional(),
	/** Set only on a `resolved` record: one confirmed citation per affected location, and when a judge verified it. */
	resolutions: z.array(z.object({ phase: z.string(), answerAt: z.string(), verifiedAt: z.string() })).default([]),
	reopened: z.array(z.object({ at: z.string(), reason: z.string(), priorStatus: z.enum(GradeFindingStatus) })).default([]),
});

export type GradeFindingRecord = z.infer<typeof GradeFindingRecord>;
