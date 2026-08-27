import { StandardsPackBundleCache } from '#src/views/common/services/StandardsPackBundleCache.ts';

/**
 * The one pack cache the views module shares.
 *
 * A single instance is the whole point: each server-function call is its own
 * pass through `listStandardsPackBundles`, and a cache scoped to one of those
 * calls would re-read the pack for every one of them.
 */
export const standardsPackBundleCache = new StandardsPackBundleCache();
