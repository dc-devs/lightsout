import type { StandardsPackBundle, StandardsPackListing } from '#src/contracts/index.ts';

interface Params {
	bundle: StandardsPackBundle;
}

/**
 * A pack's identity and counts, without its documents or its rules — what the
 * packs page lists.
 *
 * Fields are named one by one rather than spread minus two keys: the bundle is
 * what a page would otherwise receive whole, and the point of the projection is
 * that a field added to it never reaches the wire by accident.
 *
 * @param bundle - the pack read whole
 */
export const toStandardsPackListing = ({ bundle }: Params): StandardsPackListing => ({
	name: bundle.name,
	...(bundle.description === undefined ? {} : { description: bundle.description }),
	...(bundle.homepage === undefined ? {} : { homepage: bundle.homepage }),
	isDefault: bundle.isDefault,
	rootPath: bundle.rootPath,
	path: bundle.path,
	built: bundle.built,
	channels: bundle.channels,
	totals: bundle.totals,
});
