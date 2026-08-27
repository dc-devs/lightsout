import type { FrictionRecord } from '@lightsout/engine';
import { FrictionArea } from '@lightsout/engine/contracts';

interface Params {
	records: FrictionRecord[];
}

/**
 * How many entries each area holds, in `FrictionArea` order — the filter chips'
 * counts.
 *
 * Declaration order rather than count order, and every area listed even at zero:
 * the chips are a fixed row a reader learns the position of, and one that jumped
 * about as the log grew would have to be re-read every visit.
 *
 * @param records - the whole log, unfiltered, so a chip's count is the vocabulary rather than the current selection
 */
export const countFrictionByArea = ({ records }: Params): Array<{ area: FrictionArea; count: number }> =>
	Object.values(FrictionArea).map((area) => ({ area, count: records.filter((record) => record.area === area).length }));
