import type { GradedGap } from '#src/contracts/index.ts';
import { dedupeObservations } from '#src/plan/common/observations/dedupeObservations.ts';
import { gapObservations } from '#src/plan/common/observations/gapObservations.ts';
import { isBlockingGap } from '#src/plan/common/utils/isBlockingGap.ts';

interface Params {
	gaps: GradedGap[];
}

/**
 * What one gap becomes in the collapsed list: itself when it shares its record
 * and its blocking side with nothing, nothing when an earlier gap on the same
 * side survives for it, and the side's survivor carrying every member's
 * observations when it is the first of several.
 */
const collapseSide = ({ gap, gaps }: { gap: GradedGap; gaps: GradedGap[] }) => {
	const blocking = isBlockingGap({ gap });
	const side = gaps.filter((member) => member.findingId === gap.findingId && isBlockingGap({ gap: member }) === blocking);
	let collapsed: GradedGap[] = [];

	if (side.length === 1) {
		collapsed = [gap];
	} else if (side[0] === gap) {
		collapsed = [{ ...gap, observations: dedupeObservations({ observations: side.flatMap((member) => gapObservations({ gap: member })) }) }];
	}

	return collapsed;
};

/**
 * The gaps of one confirmed group reduced to the single repair item a human
 * reads, without dropping anything.
 *
 * Gaps sharing a record id collapse into one survivor that keeps the first
 * member's place and fields and carries the union of every member's
 * observations, so the one blocker names every place the defect has to be
 * fixed. A gap with no record id passes through untouched and in place.
 *
 * Members are partitioned by `isBlockingGap` first and each side collapses on
 * its own, so one record yields at most one blocker and at most one note, never
 * one swallowing the other. That case is ordinary: a pass gap ruled a note can
 * carry the id of a record still open, and `openFindingGaps` surfaces that record
 * as a blocker right after it — collapsing the two on first-member-wins would
 * delete the very blocker the surfacing exists for. This decides no ruling and
 * compares no severity; it reuses the predicate the verdict, the count and the
 * printer already share.
 */
export const collapseGroupedGaps = ({ gaps }: Params): GradedGap[] =>
	gaps.flatMap((gap) => ((gap.findingId ?? '') === '' ? [gap] : collapseSide({ gap, gaps })));
