import type { SprawlLane } from '#src/features/sprawl/common/constants/SprawlLane.ts';
import type { SprawlDataset } from '#src/features/sprawl/common/contracts/SprawlDataset.ts';
import type { SprawlLaneState } from '#src/features/sprawl/common/types/SprawlLaneState.ts';

interface Params {
	dataset: SprawlDataset;
	lane: SprawlLane;
}

/**
 * The dataset is a module-scope constant and the frames never change, so the
 * replay is done once per lane and held. A chart that recomputed it on every
 * animation tick would rebuild several hundred maps twelve times a second.
 */
const cache = new WeakMap<SprawlDataset, Map<SprawlLane, SprawlLaneState[]>>();

/**
 * Every frame's full state for one lane, replayed once from the deltas.
 *
 * A removal arrives out-of-band, in `removedFiles` and `removedFolders`, so a
 * `lines: 0` in `files` is a real measurement of an emptied file rather than a
 * sentinel — an emptied file is still drawable, a deleted one is not there at
 * all.
 *
 * @param dataset - the committed dataset, oldest frame first
 * @param lane - which of the two histories to replay
 */
export const buildSprawlLaneStates = ({ dataset, lane }: Params): SprawlLaneState[] => {
	const perLane = cache.get(dataset) ?? new Map<SprawlLane, SprawlLaneState[]>();
	const cached = perLane.get(lane);

	if (cached !== undefined) {
		return cached;
	}

	const states: SprawlLaneState[] = [];
	let files = new Map<string, number>();
	let folders = new Map<string, number>();

	for (const frame of dataset.frames) {
		const delta = frame[lane];

		files = new Map(files);
		folders = new Map(folders);

		for (const path of delta.removedFiles) {
			files.delete(path);
		}

		for (const path of delta.removedFolders) {
			folders.delete(path);
		}

		for (const file of delta.files) {
			files.set(file.path, file.lines);
		}

		for (const folder of delta.folders) {
			folders.set(folder.path, folder.entries);
		}

		states.push({ files, folders, overCap: delta.overCap });
	}

	perLane.set(lane, states);
	cache.set(dataset, perLane);

	return states;
};
