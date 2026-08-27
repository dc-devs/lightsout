import dataset from '#assets/sprawl-dataset.json';
import { SprawlDataset } from '#src/features/sprawl/common/contracts/SprawlDataset.ts';

/** Parsed once. The JSON is a build artefact bundled into the app; it cannot change while the app runs. */
let parsed: SprawlDataset | undefined;

/**
 * This repository's own history, as `scripts/buildSprawlDataset.mjs` measured
 * it and committed it to `assets/sprawl-dataset.json`.
 *
 * Parsed at the boundary like every other reader in this app: the file is
 * bundled data rather than something typechecked into existence, so it is
 * validated on the way in and never trusted on its shape.
 */
export const getSprawlDataset = (): SprawlDataset => {
	if (parsed === undefined) {
		parsed = SprawlDataset.parse(dataset);
	}

	return parsed;
};
