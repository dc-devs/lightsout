import { gatherNodeProcesses } from '#src/activity/common/utils/gatherNodeProcesses.ts';
import { nestActivityMarks } from '#src/activity/common/utils/nestActivityMarks.ts';
import { spanOfActivityNodes } from '#src/activity/common/utils/spanOfActivityNodes.ts';
import { totalActivityNode } from '#src/activity/common/utils/totalActivityNode.ts';
import type { ActivityMark } from '#src/contracts/activity/ActivityMark.ts';
import type { ActivityReport } from '#src/contracts/activity/ActivityReport.ts';

interface Params {
	/** The plan folder the record belongs to, as the caller addressed it. */
	plan: string;
	marks: ActivityMark[];
}

/**
 * Fold one record's marks into the totalled tree a report is drawn from.
 *
 * Split from the reader so this is a pure function of a mark list: every rule
 * the report depends on is then checked without a filesystem, and a terminal
 * table and its data-shaped twin read one calculation rather than each doing
 * their own.
 */
export const buildActivityTree = ({ plan, marks }: Params): ActivityReport => {
	const roots = nestActivityMarks({ marks });

	return { plan, roots, totals: totalActivityNode({ ...spanOfActivityNodes({ nodes: roots }), processes: gatherNodeProcesses({ nodes: roots }) }) };
};
