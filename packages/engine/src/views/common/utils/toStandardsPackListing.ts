import type { StandardsPackBundle } from '#src/contracts/views/StandardsPackBundle.ts';
import type { StandardsPackListing } from '#src/contracts/views/StandardsPackListing.ts';

interface Params {
	bundle: StandardsPackBundle;
}

/** Each channel's rule counts, in the pack's channel order, leaving out a channel no rule sits in. */
const countRulesByChannel = ({ bundle }: Params) =>
	bundle.channels.flatMap((channel) => {
		const rules = bundle.rules.filter((rule) => rule.channel === channel);
		const checked = rules.filter((rule) => rule.checked).length;

		return rules.length === 0 ? [] : [{ channel, rules: rules.length, checked, judgment: rules.length - checked }];
	});

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
	channelTotals: countRulesByChannel({ bundle }),
	totals: bundle.totals,
});
