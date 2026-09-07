import { GapOutcome, type GradedGap, type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { collapseText } from '#src/plan/common/memory/collapseText.ts';

interface Params {
	memory: GradeMemory;
	/** Every judged gap this pass produced — reader findings after `matchGapVerdicts`, plus the documentation checker's. */
	gaps: GradedGap[];
	/** The pass timestamp stamped on every `firstSeen`, `lastSeen` and `reopened` entry it writes. */
	at: string;
}

/** The disposition a record is created with — the judge outcome that raised it, minus the engine's own `unjudged` stamp, which opens no record at all. */
type Disposition = GradeFindingRecord['disposition'];

/** The disposition a gap records, or `undefined` for the engine's own `unjudged` stamp — which is nobody's ruling and opens no record. */
const dispositionOf = ({ outcome }: { outcome: GradedGap['outcome'] }): Disposition | undefined => (outcome === GapOutcome.Unjudged ? undefined : outcome);

/**
 * Every optional field present as an own key, so a record the fold returns says
 * "no agent decision was recorded" rather than staying silent about it. Absence
 * and an explicit nothing read alike to a human and differently to every
 * comparison.
 */
const complete = ({ record }: { record: GradeFindingRecord }): GradeFindingRecord => ({
	lens: undefined,
	humanDecision: undefined,
	agentDecision: undefined,
	safeBecause: undefined,
	answerAt: undefined,
	resolution: undefined,
	...record,
});

/** The record a fresh finding opens: its identity from the reader, its disposition from the judge, kept verbatim from here on. */
const openRecord = ({ gap, disposition, id, at }: { gap: GradedGap; disposition: Disposition; id: string; at: string }): GradeFindingRecord =>
	complete({
		record: {
			id,
			phase: gap.phase,
			lens: gap.lens,
			area: gap.area,
			gap: gap.gap,
			decision: gap.decision,
			options: gap.options,
			firstSeen: at,
			lastSeen: at,
			// A human's question blocks; a question the judge itself settled is kept
			// only so the next pass does not re-investigate it, and gates nothing.
			status: disposition === GapOutcome.NeedsAHuman ? GradeFindingStatus.Open : GradeFindingStatus.Noted,
			disposition,
			humanDecision: gap.humanDecision,
			agentDecision: gap.agentDecision,
			safeBecause: gap.safeBecause,
			answerAt: gap.answerAt,
			reopened: [],
		},
	});

/**
 * A record this pass saw again. Only a `needs-a-human` ruling may undo a
 * closure, and nothing rewrites the disposition the record was created with: a
 * human's question is answered in the plan, never downgraded to an assumption by
 * a later judge.
 */
const touchRecord = ({ record, gap, at }: { record: GradeFindingRecord; gap: GradedGap; at: string }): GradeFindingRecord => {
	const closed = record.status === GradeFindingStatus.Resolved || record.status === GradeFindingStatus.Noted;

	if (!closed || gap.outcome !== GapOutcome.NeedsAHuman) {
		return complete({ record: { ...record, lastSeen: at } });
	}

	const reopened = [...record.reopened, { at, reason: gap.humanDecision ?? gap.decision, priorStatus: record.status }];

	return complete({ record: { ...record, status: GradeFindingStatus.Open, resolution: undefined, lastSeen: at, reopened } });
};

/** Whether a finding no judge could name a record for is the same question as a record — same plan file, same area, same words. */
const matchesByText = ({ record, gap }: { record: GradeFindingRecord; gap: GradedGap }) =>
	record.phase === gap.phase && record.area === gap.area && collapseText({ text: record.gap }) === collapseText({ text: gap.gap });

/** Which record a gap belongs to, or `-1` for one the memory has never seen. */
const findRecord = ({ findings, gap }: { findings: GradeFindingRecord[]; gap: GradedGap }) =>
	findings.findIndex((record) => (gap.findingId === undefined ? gap.lens === undefined && matchesByText({ record, gap }) : record.id === gap.findingId));

/**
 * Fold this pass's judged gaps into the plan's durable record set, and stamp
 * each returned gap with the record it merged into.
 *
 * The input `gaps` array drives the loop and the output keeps its membership and
 * order exactly, for the reason `matchGapVerdicts` builds its result from its
 * input: a finding that vanished in the fold would read as a plan with less
 * wrong than it has.
 *
 * A gap resolves to a record three ways. An `unjudged` gap opens and touches
 * nothing — nobody weighed it, and a record carrying no disposition would let
 * the next pass read it as settled. A gap the judge matched to a record already
 * carries that record's id, validated by `matchGapVerdicts`. A finding no
 * per-file lens produced — the whole-plan documentation checker's, which
 * bypasses the judge — matches deterministically on its phase, its area and its
 * gap text, because no verdict can name a record for it and without the match it
 * would open a duplicate every pass.
 */
export const mergeFindingRecords = ({ memory, gaps, at }: Params): { memory: GradeMemory; gaps: GradedGap[] } => {
	const findings = [...memory.findings];
	const stamped: GradedGap[] = [];
	let nextFindingNumber = memory.nextFindingNumber;

	for (const gap of gaps) {
		const disposition = dispositionOf({ outcome: gap.outcome });

		if (disposition === undefined) {
			stamped.push(gap);
			continue;
		}

		const index = findRecord({ findings, gap });

		if (index === -1) {
			const id = `f${nextFindingNumber}`;

			nextFindingNumber += 1;
			findings.push(openRecord({ gap, disposition, id, at }));
			stamped.push({ ...gap, findingId: id });
			continue;
		}

		findings[index] = touchRecord({ record: findings[index], gap, at });
		stamped.push({ ...gap, findingId: findings[index].id });
	}

	return { memory: { ...memory, findings, nextFindingNumber }, gaps: stamped };
};
