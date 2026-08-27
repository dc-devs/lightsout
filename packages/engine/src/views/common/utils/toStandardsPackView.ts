import type { StandardsPackBundle, StandardsPackView } from '#src/contracts/index.ts';
import { toStandardsPackListing } from '#src/views/common/utils/toStandardsPackListing.ts';
import { toStandardsPackRuleListing } from '#src/views/common/utils/toStandardsPackRuleListing.ts';

interface Params {
	bundle: StandardsPackBundle;
}

/**
 * The pack page's payload: the listing, the documents that group its rules, and
 * one row per rule.
 *
 * The prose and the fixture text stay behind — the default pack's fixtures alone
 * run to about two megabytes, and inlining them into the page's server-rendered
 * HTML would dwarf the page they decorate. A rule's own text arrives when a
 * reader opens that rule.
 *
 * @param bundle - the pack read whole
 */
export const toStandardsPackView = ({ bundle }: Params): StandardsPackView => ({
	...toStandardsPackListing({ bundle }),
	documents: bundle.documents,
	rules: bundle.rules.map((rule) => toStandardsPackRuleListing({ rule, fixtureCounts: rule.fixtureCounts })),
});
