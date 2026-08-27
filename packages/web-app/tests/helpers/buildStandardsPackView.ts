import type { StandardsPackDocumentView, StandardsPackRuleListing, StandardsPackView } from '@lightsout/engine';
import { StandardsSet } from '@lightsout/engine/contracts';
import { buildStandardsPackListing } from '#tests/helpers/buildStandardsPackListing.ts';
import { buildStandardsPackRuleListing } from '#tests/helpers/buildStandardsPackRuleListing.ts';

/** One document per distinct `documentPath` the rules name, each holding its own rules in order. */
const buildDocuments = ({ rules }: { rules: StandardsPackRuleListing[] }) =>
	[...new Set(rules.map((rule) => rule.documentPath))].map(
		(path): StandardsPackDocumentView => ({
			set: rules.find((rule) => rule.documentPath === path)?.set ?? StandardsSet.Code,
			path,
			channel: rules.find((rule) => rule.documentPath === path)?.channel ?? 'base',
			intro: `What ${path} argues.`,
			ruleIds: rules.filter((rule) => rule.documentPath === path).map((rule) => rule.id),
		}),
	);

interface Params {
	name?: string;
	isDefault?: boolean;
	path?: string;
	rules?: StandardsPackRuleListing[];
	/** Left out, one document per distinct `documentPath` across the rules. */
	documents?: StandardsPackDocumentView[];
	/** Applied last, so a test can drop an optional field the defaults fill. */
	overrides?: Partial<StandardsPackView>;
}

/** One pack as its page shows it: the listing row, its documents, and every rule's row. */
export const buildStandardsPackView = ({
	name = 'lightsout-defaults',
	isDefault = true,
	path = 'packages/standards-typescript',
	rules = [buildStandardsPackRuleListing()],
	documents = buildDocuments({ rules }),
	overrides = {},
}: Params = {}): StandardsPackView => ({
	...buildStandardsPackListing({ name, isDefault, path, totals: { rules: rules.length, checked: rules.filter((rule) => rule.checked).length } }),
	documents,
	rules,
	...overrides,
});
