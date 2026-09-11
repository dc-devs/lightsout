import { type GapBatchVerdict, type GapGroupVerdict, GapOutcome, type GradedGap } from '#src/contracts/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { noJudgeRanReason } from '#src/plan/common/constants/noJudgeRanReason.ts';
import { accountBatchVerdicts } from '#src/plan/common/grading/accountBatchVerdicts.ts';
import type { GapBatch } from '#src/plan/common/types/GapBatch.ts';
import type { GapRuling } from '#src/plan/common/types/GapRuling.ts';

interface Params {
	/** Repo root — a cited path is resolved against it before being checked. */
	cwd: string;
	/** Every finding the pass judges, in the order the batches index them by. */
	gaps: GradedGap[];
	/** The batches the judges were spawned for. */
	batches: GapBatch[];
	/** Each batch's judge outcome at the same index; `undefined` where the fan-out never started that judge. */
	batchOutcomes: Array<AgentOutcome<GapBatchVerdict> | undefined>;
	/** Why no judge ran, when the caller already knows — the rate-limit wall it declined to spawn into. Defaults to the fan-out having stopped mid-flight. */
	noJudgeReason?: string;
	/** Every memory record id a judge may name — what a verdict's `matchesFinding` is checked against. Absent means the plan has none, so any id points nowhere. */
	recordIds?: Set<string>;
}

/** The judge's half of a ruling as a gap carries it — only the fields the verdict actually holds, so an absent one stays absent rather than reading as an explicit nothing. */
const rulingFields = ({ verdict }: { verdict: GapGroupVerdict }) => ({
	outcome: verdict.outcome,
	...(verdict.humanDecision === undefined ? {} : { humanDecision: verdict.humanDecision }),
	...(verdict.agentDecision === undefined ? {} : { agentDecision: verdict.agentDecision }),
	...(verdict.safeBecause === undefined ? {} : { safeBecause: verdict.safeBecause }),
});

/** One finding with the ruling that settles it written on, or stamped `unjudged` with the reason nobody did. */
const joinRuling = ({ gap, ruling, noJudgeReason }: { gap: GradedGap; ruling?: GapRuling; noJudgeReason?: string }): GradedGap => {
	const verdict = ruling?.unjudgedReason === undefined ? ruling?.verdict : undefined;

	if (verdict === undefined) {
		return { ...gap, outcome: GapOutcome.Unjudged, unjudgedReason: ruling?.unjudgedReason ?? noJudgeReason ?? noJudgeRanReason };
	}

	return {
		...gap,
		// A carried pending finding arrives with the reason an earlier pass left it
		// unjudged; once a judge rules, that reason is stale.
		...(gap.unjudgedReason === undefined ? {} : { unjudgedReason: undefined }),
		...rulingFields({ verdict }),
		...(ruling?.answerAt === undefined ? {} : { answerAt: ruling.answerAt }),
		...(ruling?.observations === undefined ? {} : { groupId: ruling.groupId, sharedDefect: verdict.sharedDefect, observations: ruling.observations }),
		// The agent's raw claim never reaches the record: what is persisted is the id
		// the engine resolved. A carried finding with no match keeps the record it
		// already belongs to, or it would open a second one every pass.
		...(verdict.matchesFinding === undefined ? {} : { findingId: verdict.matchesFinding }),
	};
};

/**
 * Join what the readers found with how the batch judges weighed it.
 *
 * The two halves of a judged gap come from different places and neither is
 * authoritative alone: the finding and its `phase`/`lens` are the engine's
 * stamps, while who has to settle it is the agent's judgment. Each batch's
 * rulings are first accounted by `accountBatchVerdicts`, which applies every
 * fail-closed evidence rule per ruling and keys what it decides by each
 * finding's position in `gaps`. The findings then drive the loop and the result
 * keeps their membership and order exactly, so a finding can never vanish
 * between the readers and the report — even though a batch fan-out's task count
 * no longer equals the finding count.
 *
 * Every unjudged gap is stamped here and nowhere else: a finding its judge
 * refused, a finding whose batch never started, and a finding no batch held at
 * all, whose plan file no longer exists.
 *
 * A ruling covering two or more findings writes the same group id, shared-defect
 * statement and observation list onto every one of them, which is what lets the
 * memory fold open one record for the defect they are.
 */
export const matchGapVerdicts = async ({ cwd, gaps, batches, batchOutcomes, noJudgeReason, recordIds = new Set() }: Params): Promise<GradedGap[]> => {
	const rulings = new Map<number, GapRuling>();

	for (const [slot, batch] of batches.entries()) {
		const accounted = await accountBatchVerdicts({ cwd, batch, outcome: batchOutcomes[slot], recordIds, noJudgeReason });

		for (const [index, ruling] of accounted) {
			rulings.set(index, ruling);
		}
	}

	return gaps.map((gap, index) => joinRuling({ gap, ruling: rulings.get(index), noJudgeReason }));
};
