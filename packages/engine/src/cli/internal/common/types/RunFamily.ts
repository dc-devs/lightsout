import type { RunListing } from '#src/contracts/views/RunListing.ts';

/**
 * One run family: a phased plan's coordinator and the phase children it
 * started, treated as one thing.
 *
 * A phased plan has two live manifests at once, and counting them as two runs
 * would call every phased run ambiguous. They share a root, so they are one
 * family and one choice.
 */
export interface RunFamily {
	/** The coordinator's run id, or the run's own id when it has no coordinator. */
	root: string;
	/** Every member of the family, in the order the listing answered — newest updated first. */
	runs: RunListing[];
}
