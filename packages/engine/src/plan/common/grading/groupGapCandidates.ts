import { basename } from 'node:path';
import { groupConnectedFiles } from '#src/common/fileGroups/groupConnectedFiles.ts';
import type { GradedGap } from '#src/contracts/index.ts';
import { gapBatchLimits } from '#src/plan/common/constants/gapBatchLimits.ts';
import { distinctiveWords } from '#src/plan/common/grading/distinctiveWords.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { GapBatch } from '#src/plan/common/types/GapBatch.ts';
import { findingLocations } from '#src/plan/common/utils/findingLocations.ts';

interface Params {
	/** Every finding this pass will judge — the readers' output plus the pending records carried forward. */
	gaps: GradedGap[];
	/** EVERY plan file the deliverable holds, with its current text — not the readers' selection. A finding none of whose locations names one of them is in no batch. */
	files: DeliverableFile[];
}

/** One finding the batching can place: its engine identifier, its position in the pass, its live locations with their text, and the words that hint at its defect. */
interface Candidate {
	id: string;
	index: number;
	gap: GradedGap;
	locations: Array<{ phase: string; text: string }>;
	words: Set<string>;
}

/**
 * Each finding with its live locations — `findingLocations` minus any plan file
 * the deliverable no longer holds — and nothing for a finding left with none. A
 * stale location is dropped rather than the whole finding, so a grouped record
 * stays judgeable at the plan files that still exist, while a finding with no
 * text anywhere to judge it against reaches the join unjudged, which blocks.
 */
const candidatesOf = ({ gaps, files }: Params): Candidate[] =>
	gaps.flatMap((gap, index) => {
		const locations = findingLocations({ observations: gap.observations, phase: gap.phase }).flatMap((phase) => {
			const file = files.find((candidate) => basename(candidate.path) === phase);

			return file === undefined ? [] : [{ phase, text: file.text }];
		});

		return locations.length === 0 ? [] : [{ id: `o${index + 1}`, index, gap, locations, words: distinctiveWords({ text: `${gap.gap} ${gap.decision}` }) }];
	});

/**
 * Every pair of findings whose combined finding-and-decision text shares at
 * least two distinctive words. There is deliberately no phase, lens or area
 * requirement: area is a label the lens assigns rather than a property of the
 * defect, so requiring one would keep apart exactly the cross-phase
 * contradiction a single judge has to see whole.
 */
const relatedPairs = ({ candidates }: { candidates: Candidate[] }) => {
	const minimumSharedWords = 2;

	return candidates.flatMap((first, position) =>
		candidates
			.slice(position + 1)
			.filter((second) => [...first.words].filter((word) => second.words.has(word)).length >= minimumSharedWords)
			.map((second) => ({ from: first.id, to: second.id })),
	);
};

/** The union of some findings' locations, first appearance first — what a batch of them spans. */
const spannedLocations = ({ members }: { members: Candidate[] }) => [
	...new Map(members.flatMap((member) => member.locations).map((location) => [location.phase, location])).values(),
];

/**
 * One candidate group split greedily, in finding order, into batches that each
 * honour both caps — the shape `chunkFileGroup` splits with, bounded by two caps
 * at once rather than one. A finding joins the batch before it only when the
 * combined batch still fits, so a single finding is never split and one already
 * over the plan-file cap on its own becomes a batch of one.
 */
const splitGroup = ({ members }: { members: Candidate[] }) => {
	const batches: Candidate[][] = [];

	for (const member of members) {
		const last = batches.at(-1);
		const fits =
			last !== undefined &&
			last.length < gapBatchLimits.maxObservations &&
			spannedLocations({ members: [...last, member] }).length <= gapBatchLimits.maxPlanFiles;

		if (fits) {
			last.push(member);
		} else {
			batches.push([member]);
		}
	}

	return batches;
};

/**
 * The deterministic batching stage: which findings are offered to one judge
 * together, with no agent involved.
 *
 * Candidate groups are the connected components of the shared-words relation,
 * split so every batch honours both caps, each batch independently adjudicable.
 * A finding with no partner is a batch of one, judged exactly as it would be
 * alone — so this stage can only remove judge calls, never add them. Findings
 * are named `o1`, `o2`, … by their position in `gaps`; those per-call names are
 * the only ones a judge may put in `covers`.
 *
 * A batch's plan texts are the union of `findingLocations` over its findings —
 * a carried grouped finding brings its whole observation list — and that same
 * union is what the plan-file cap counts and what `accountBatchVerdicts` demands
 * a citation for, so a citation is never demanded against text the judge was
 * not given. The text comes from every plan file, not the readers' selection,
 * because a pending record carried forward may name a file no reader read this
 * pass, and a finding in no batch would never be retried.
 *
 * Output order follows the findings, never `Map` iteration: a grade that batched
 * differently on two runs of the same inputs could not be compared across
 * passes.
 */
export const groupGapCandidates = ({ gaps, files }: Params): GapBatch[] => {
	const candidates = candidatesOf({ gaps, files });
	const components = groupConnectedFiles({ files: candidates.map(({ id }) => id), edges: relatedPairs({ candidates }) });
	const groups = components
		.map((component) => {
			const members = new Set(component);

			return candidates.filter(({ id }) => members.has(id));
		})
		.sort((first, second) => first[0].index - second[0].index);

	return groups.flatMap((members) =>
		splitGroup({ members }).map((batch) => ({
			observations: batch.map(({ id, index, gap }) => ({ id, index, gap })),
			planTexts: spannedLocations({ members: batch }),
		})),
	);
};
