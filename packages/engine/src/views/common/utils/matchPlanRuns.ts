import type { RunListing } from '#src/contracts/index.ts';

interface Params {
	name: string;
	runs: RunListing[];
}

/**
 * The runs that recorded this plan as the one they belong to, newest first.
 *
 * Equality against a declared name rather than a guess from a plan path: a run
 * states its plan on its own manifest, so a plan folder renamed after the run
 * started, or an overview named by a different spelling, still answers. A run
 * that belongs to no plan records no name and is claimed by nobody.
 *
 * `listRuns` already returns newest first, so the given order is kept rather
 * than re-sorted.
 */
export const matchPlanRuns = ({ name, runs }: Params): RunListing[] => runs.filter((run) => run.planName === name);
