import { gatherNodeProcesses } from '#src/activity/common/utils/gatherNodeProcesses.ts';
import { spanOfActivityNodes } from '#src/activity/common/utils/spanOfActivityNodes.ts';
import { totalActivityNode } from '#src/activity/common/utils/totalActivityNode.ts';
import type { ActivityReport, ActivityTotals } from '#src/contracts/index.ts';

interface Params {
	/** One fold per plan, each already built by `buildActivityTree`. */
	reports: ActivityReport[];
}

/**
 * Several folds added together as one set of totals — what a ticket holding
 * more than one plan reports.
 *
 * It exists because those figures cannot be added up from the per-plan totals.
 * Tokens, stated cost, agent time and process count add; busy time is a union
 * of intervals and idle time follows from it; and peak concurrency is the most
 * processes running at one instant across the whole ticket, which is never the
 * sum of each plan's own peak, nor the largest of them — two plans peaking at
 * two apiece can hold three processes at one moment.
 *
 * So it gathers every process below every root and hands them, with the window
 * spanning them all, to the same function the per-plan fold uses. A ticket row
 * and a plan row then cannot disagree about what busy time or peak concurrency
 * mean, which is the reason `ActivityTotals` carries both `busyMs` and `idleMs`
 * rather than leaving a renderer to subtract them.
 */
export const totalActivityReports = ({ reports }: Params): ActivityTotals => {
	const roots = reports.flatMap((report) => report.roots);

	return totalActivityNode({ ...spanOfActivityNodes({ nodes: roots }), processes: gatherNodeProcesses({ nodes: roots }) });
};
