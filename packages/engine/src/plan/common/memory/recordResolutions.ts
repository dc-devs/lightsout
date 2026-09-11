import type { GradeFindingRecord } from '#src/contracts/index.ts';

interface Params {
	record: GradeFindingRecord;
}

/**
 * Every per-location resolution a resolved record holds — including for a record
 * closed before per-location resolutions existed, whose single legacy
 * `resolution` reads as one entry at the record's own phase.
 *
 * Every write fills `resolutions` and clears `resolution`, so the legacy field
 * only ever shrinks; without this read, an old closure would carry no citation
 * anybody could re-validate.
 */
export const recordResolutions = ({ record }: Params): Array<{ phase: string; answerAt: string; verifiedAt: string }> => {
	let resolutions = record.resolutions;

	if (resolutions.length === 0 && record.resolution !== undefined) {
		resolutions = [{ phase: record.phase, ...record.resolution }];
	}

	return resolutions;
};
