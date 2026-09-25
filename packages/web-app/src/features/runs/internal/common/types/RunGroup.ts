import type { RunListing } from '@lightsout/engine';

/** One top-level run and the phase runs folded under it; a run that started none carries an empty list. */
export interface RunGroup {
	run: RunListing;
	children: RunListing[];
}
