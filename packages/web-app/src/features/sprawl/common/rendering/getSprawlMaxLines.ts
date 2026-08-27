import { SprawlLane } from '#src/features/sprawl/common/constants/SprawlLane.ts';
import type { SprawlDataset } from '#src/features/sprawl/common/contracts/SprawlDataset.ts';
import { buildSprawlLaneStates } from '#src/features/sprawl/common/rendering/buildSprawlLaneStates.ts';

interface Params {
	dataset: SprawlDataset;
}

/** Held for the same reason the lane states are: the answer cannot change while the app is running. */
const cache = new WeakMap<SprawlDataset, number>();

/**
 * The tallest file across every frame of both lanes — the one vertical scale
 * both charts share.
 *
 * Shared rather than per lane, because the without lane's summed-back files are
 * by construction the taller ones. Scaled to itself, each lane would draw bars
 * of the same height and the comparison would read as no difference at all.
 *
 * @param dataset - the committed dataset
 */
export const getSprawlMaxLines = ({ dataset }: Params): number => {
	const cached = cache.get(dataset);

	if (cached !== undefined) {
		return cached;
	}

	let maxLines = 0;

	for (const lane of [SprawlLane.With, SprawlLane.Without]) {
		for (const state of buildSprawlLaneStates({ dataset, lane })) {
			for (const lines of state.files.values()) {
				maxLines = Math.max(maxLines, lines);
			}
		}
	}

	cache.set(dataset, maxLines);

	return maxLines;
};
