import type { RunListing } from '@lightsout/engine';
import type { RunGroup } from '#src/features/runs/common/types/RunGroup.ts';

interface Params {
	runs: RunListing[];
}

/**
 * Coordinators at the top level, each carrying the phase runs whose
 * `parentRunId` names it.
 *
 * A child whose coordinator is not in this list — filtered away, or deleted —
 * is promoted to the top level rather than dropped: a run must never become
 * unreachable because something else was narrowed out from under it.
 */
export const foldPhaseChildren = ({ runs }: Params): RunGroup[] => {
	const present = new Set(runs.map((run) => run.runId));
	const childrenByParent = new Map<string, RunListing[]>();

	for (const run of runs) {
		const parent = run.parentRunId;

		if (parent !== undefined && present.has(parent)) {
			childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), run]);
		}
	}

	return runs
		.filter((run) => run.parentRunId === undefined || !present.has(run.parentRunId))
		.map((run) => ({ run, children: childrenByParent.get(run.runId) ?? [] }));
};
