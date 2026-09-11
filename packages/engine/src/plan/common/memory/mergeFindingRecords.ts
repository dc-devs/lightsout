import { GapOutcome, type GradedGap, type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { absorbObservations } from '#src/plan/common/memory/absorbObservations.ts';
import { collapseText } from '#src/plan/common/memory/collapseText.ts';
import { recordObservations } from '#src/plan/common/memory/recordObservations.ts';
import { reopenRecord } from '#src/plan/common/memory/reopenRecord.ts';
import { gapObservations } from '#src/plan/common/observations/gapObservations.ts';

interface Params {
	memory: GradeMemory;
	/** Every judged gap this pass produced — the judged findings after `matchGapVerdicts`, plus the documentation checker's. */
	gaps: GradedGap[];
	/** The pass timestamp stamped on every `firstSeen`, `lastSeen` and `reopened` entry it writes. */
	at: string;
}

/** A judge's ruling as a record keeps it — the engine's own `unjudged` stamp is nobody's ruling and is never one. */
type Disposition = NonNullable<GradeFindingRecord['disposition']>;

/** The disposition a gap records, or `undefined` for the engine's own `unjudged` stamp. */
const dispositionOf = ({ outcome }: { outcome: GradedGap['outcome'] }): Disposition | undefined => (outcome === GapOutcome.Unjudged ? undefined : outcome);

/** A human's question blocks; a question the judge itself settled is kept only so the next pass does not re-investigate it. */
const statusFor = ({ disposition }: { disposition: Disposition }) =>
	disposition === GapOutcome.NeedsAHuman ? GradeFindingStatus.Open : GradeFindingStatus.Noted;

/**
 * Every optional field present as an own key, so a record the fold returns says
 * "no agent decision was recorded" rather than staying silent about it. Absence
 * and an explicit nothing read alike to a human and differently to every
 * comparison.
 */
const complete = ({ record }: { record: GradeFindingRecord }): GradeFindingRecord => ({
	lens: undefined,
	disposition: undefined,
	unjudgedReason: undefined,
	sharedDefect: undefined,
	supersededBy: undefined,
	humanDecision: undefined,
	agentDecision: undefined,
	safeBecause: undefined,
	answerAt: undefined,
	resolution: undefined,
	...record,
});

/** The record a fresh finding opens: its identity and observations from the gap, its disposition from the judge — or `pending`, with the reason, when no judge settled it. */
const openRecord = ({ gap, id, at }: { gap: GradedGap; id: string; at: string }): GradeFindingRecord => {
	const disposition = dispositionOf({ outcome: gap.outcome });

	return complete({
		record: {
			id,
			phase: gap.phase,
			lens: gap.lens,
			area: gap.area,
			gap: gap.gap,
			decision: gap.decision,
			options: gap.options,
			observations: gapObservations({ gap }),
			firstSeen: at,
			lastSeen: at,
			status: disposition === undefined ? GradeFindingStatus.Pending : statusFor({ disposition }),
			disposition,
			unjudgedReason: disposition === undefined ? gap.unjudgedReason : undefined,
			sharedDefect: gap.sharedDefect,
			humanDecision: gap.humanDecision,
			agentDecision: gap.agentDecision,
			safeBecause: gap.safeBecause,
			answerAt: gap.answerAt,
			resolutions: [],
			reopened: [],
		},
	});
};

/**
 * A record with no disposition yet, given its first real ruling: written for the
 * first and only time, with the unjudged reason cleared. A `pending` record takes
 * the status the ruling implies; a survivor the group pre-pass already raised to
 * `open` stays open, because a group ruling must not discharge the unanswered
 * obligation that raise exists to keep blocking.
 */
const promote = ({ record, gap }: { record: GradeFindingRecord; gap: GradedGap }): GradeFindingRecord => {
	const disposition = dispositionOf({ outcome: gap.outcome });

	if (record.disposition !== undefined || disposition === undefined) {
		return record;
	}

	return {
		...record,
		status: record.status === GradeFindingStatus.Pending ? statusFor({ disposition }) : record.status,
		disposition,
		unjudgedReason: undefined,
		humanDecision: record.humanDecision ?? gap.humanDecision,
		agentDecision: gap.agentDecision,
		safeBecause: gap.safeBecause,
		answerAt: gap.answerAt,
	};
};

/**
 * A record this pass saw again. Only a `needs-a-human` ruling may undo a
 * closure, and nothing rewrites a disposition the record already carries: a
 * human's question is answered in the plan, never downgraded to an assumption by
 * a later judge. What the gap contributes — its observations, or the one its
 * identity describes — always joins, so a finding attached at a new plan file
 * makes the record answer for that file too.
 */
const touchRecord = ({ record, gap, at }: { record: GradeFindingRecord; gap: GradedGap; at: string }): GradeFindingRecord => {
	const seen = promote({ record: { ...record, lastSeen: at, sharedDefect: record.sharedDefect ?? gap.sharedDefect }, gap });
	const closed = seen.status === GradeFindingStatus.Resolved || seen.status === GradeFindingStatus.Noted;
	const ruled = closed && gap.outcome === GapOutcome.NeedsAHuman ? reopenRecord({ record: seen, reason: gap.humanDecision ?? gap.decision, at }) : seen;

	return complete({ record: absorbObservations({ record: ruled, observations: gapObservations({ gap }), at }) });
};

/** Whether a finding nobody could name a record for is the same question as a record — same plan file, same area, same words. */
const matchesByText = ({ record, gap }: { record: GradeFindingRecord; gap: GradedGap }) =>
	record.phase === gap.phase && record.area === gap.area && collapseText({ text: record.gap }) === collapseText({ text: gap.gap });

/** The record a superseded one handed its obligation to, chased until one is not superseded. A survivor is always the earliest-created, so the chain cannot loop. */
const followSupersede = ({ findings, index }: { findings: GradeFindingRecord[]; index: number }): number =>
	index !== -1 && findings[index].status === GradeFindingStatus.Superseded
		? followSupersede({ findings, index: findings.findIndex((record) => record.id === findings[index].supersededBy) })
		: index;

/**
 * Which record a gap belongs to, or `-1` for one the memory has never seen. A
 * matched or carried gap names its record; the documentation checker's finding,
 * which bypasses the judge, matches on plan file, area and words; and an
 * unjudged finding matches a `pending` record the same way, so a question nobody
 * could judge two passes running stays one record.
 */
const findRecord = ({ findings, gap }: { findings: GradeFindingRecord[]; gap: GradedGap }) => {
	let matches: (record: GradeFindingRecord) => boolean = () => false;

	if (gap.findingId !== undefined) {
		matches = (record) => record.id === gap.findingId;
	} else if (gap.lens === undefined) {
		matches = (record) => matchesByText({ record, gap });
	} else if (gap.outcome === GapOutcome.Unjudged) {
		matches = (record) => record.status === GradeFindingStatus.Pending && matchesByText({ record, gap });
	}

	return followSupersede({ findings, index: findings.findIndex(matches) });
};

/** Creation order: `f10` was handed out after `f9`, which a string comparison would get backwards. */
const creationOrder = ({ record }: { record: GradeFindingRecord }) => Number(record.id.slice(1));

/**
 * One absorbed record's obligation moved onto the survivor. The absorbed record
 * keeps its id and history and stops blocking; the survivor takes its
 * observations, a human question where it has none, and — when the absorbed
 * record was still unanswered — is raised to `open` with its citations cleared.
 */
const supersede = ({ survivor, absorbed, at }: { survivor: GradeFindingRecord; absorbed: GradeFindingRecord; at: string }) => {
	const unanswered = absorbed.status === GradeFindingStatus.Open || absorbed.status === GradeFindingStatus.Pending;
	const reason = `absorbed the unanswered obligation of ${absorbed.id} when a judge confirmed the two were one defect`;
	const carrying = { ...survivor, humanDecision: survivor.humanDecision ?? absorbed.humanDecision };
	const raised = unanswered && carrying.status !== GradeFindingStatus.Open ? reopenRecord({ record: carrying, reason, at }) : carrying;

	return {
		survivor: absorbObservations({ record: raised, observations: recordObservations({ record: absorbed }), at }),
		absorbed: { ...absorbed, status: GradeFindingStatus.Superseded, supersededBy: survivor.id },
	};
};

/**
 * The group pre-pass: each confirmed group whose members already belong to
 * records is pinned to ONE of them — the one record they share, or the
 * earliest-created of several, which supersedes the rest. A group with no record
 * yet is left to the main loop, which opens one at its first member.
 */
const pinGroups = ({ memory, gaps, at }: { memory: GradeMemory; gaps: GradedGap[]; at: string }) => {
	const findings = [...memory.findings];
	const pinned = new Map<string, string>();

	for (const groupId of new Set(gaps.flatMap((gap) => (gap.groupId === undefined ? [] : [gap.groupId])))) {
		const members = gaps.filter((gap) => gap.groupId === groupId && gap.findingId !== undefined);
		const indexes = [...new Set(members.map((gap) => findRecord({ findings, gap })).filter((index) => index !== -1))];
		const ordered = indexes.sort((first, second) => creationOrder({ record: findings[first] }) - creationOrder({ record: findings[second] }));
		const [survivorIndex, ...absorbedIndexes] = ordered;

		for (const absorbedIndex of absorbedIndexes) {
			const moved = supersede({ survivor: findings[survivorIndex], absorbed: findings[absorbedIndex], at });

			findings[survivorIndex] = complete({ record: moved.survivor });
			findings[absorbedIndex] = complete({ record: moved.absorbed });
		}

		if (survivorIndex !== undefined) {
			pinned.set(groupId, findings[survivorIndex].id);
		}
	}

	return { findings, pinned };
};

/**
 * Fold this pass's judged gaps into the plan's durable record set, and stamp
 * each returned gap with the record it merged into.
 *
 * The input `gaps` array drives the loop and the output keeps its membership and
 * order exactly, for the reason `matchGapVerdicts` builds its result from its
 * input: a finding that vanished in the fold would read as a plan with less
 * wrong than it has.
 *
 * Every gap of one confirmed group lands on ONE record, which is what makes a
 * shared defect one repair item — and a group spanning several records moves
 * their obligations onto the earliest rather than deleting them. An `unjudged`
 * gap opens a `pending` record that blocks and is re-offered to the next pass's
 * judge, so a finding nobody weighed survives a `grade.json` overwrite.
 */
export const mergeFindingRecords = ({ memory, gaps, at }: Params): { memory: GradeMemory; gaps: GradedGap[] } => {
	const { findings, pinned } = pinGroups({ memory, gaps, at });
	const stamped: GradedGap[] = [];
	let nextFindingNumber = memory.nextFindingNumber;

	for (const gap of gaps) {
		const pinnedId = gap.groupId === undefined ? undefined : pinned.get(gap.groupId);
		const index = pinnedId === undefined ? findRecord({ findings, gap }) : findings.findIndex((record) => record.id === pinnedId);

		if (index === -1) {
			const id = `f${nextFindingNumber}`;

			nextFindingNumber += 1;
			findings.push(openRecord({ gap, id, at }));
			stamped.push({ ...gap, findingId: id });

			if (gap.groupId !== undefined) {
				pinned.set(gap.groupId, id);
			}

			continue;
		}

		findings[index] = touchRecord({ record: findings[index], gap, at });
		stamped.push({ ...gap, findingId: findings[index].id });
	}

	return { memory: { ...memory, findings, nextFindingNumber }, gaps: stamped };
};
