import type { RunListing } from '#src/contracts/index.ts';
import { planWorkspacePath } from '#src/plan/index.ts';

interface Params {
	name: string;
	runs: RunListing[];
}

/**
 * The runs whose plan path sits inside this workspace, newest first.
 *
 * Prefix rather than exact match: a phased plan's runs each name a different
 * phase file and its coordinator names `overview.md`, so an exact match would
 * show one run out of thirteen. The legacy `.claude/plans/` prefix is matched
 * too — manifests on disk still carry it.
 *
 * `listRuns` already returns newest first, so the given order is kept rather
 * than re-sorted.
 */
export const matchPlanRuns = ({ name, runs }: Params): RunListing[] => {
	const prefix = `${planWorkspacePath({ name })}/`;
	// Spelled out rather than derived: nothing writes this folder any more, so it
	// is a historical constant rather than another form of the path above.
	const legacyPrefix = `.claude/plans/${name}/`;

	return runs.filter((run) => run.plan.startsWith(prefix) || run.plan.startsWith(legacyPrefix));
};
