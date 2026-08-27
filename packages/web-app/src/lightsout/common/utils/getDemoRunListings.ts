import { RunListing } from '@lightsout/engine/contracts';
import { z } from 'zod';
import listings from '#assets/demo-runs/listings.json';

/** Parsed once, for the same reason `getDemoRunViews` is: the file is bundled data that cannot change while the app runs. */
let parsed: RunListing[] | undefined;

/**
 * The three frozen runs as the runs list shows them, newest first — the rows a
 * build holding no repo answers `listRuns()` with.
 *
 * A second accessor rather than a field on `getDemoRunViews`, so each frozen
 * file has exactly one reader: the proof section needs the rows to label its
 * tabs without pulling a quarter of a megabyte of run detail into the page that
 * lazily loads it.
 */
export const getDemoRunListings = (): RunListing[] => {
	if (parsed === undefined) {
		parsed = z.array(RunListing).parse(listings);
	}

	return parsed;
};
