import type { StandardsPackDocumentView, StandardsPackRuleListing } from '@lightsout/engine';

interface Params {
	documents: StandardsPackDocumentView[];
	rules: StandardsPackRuleListing[];
}

/**
 * A pack's rules under the document each one is stated in.
 *
 * Documents keep the order the pack assembles them in, and inside a document
 * the rules keep the order that document's own `ruleIds` names — the reading
 * order the pack author chose, not alphabetical.
 *
 * A rule belonging to no document is dropped, and a document left with no rules
 * is dropped with it: given a filtered list, a run of empty headings explains
 * nothing.
 *
 * @param documents - the pack's documents, in pack order
 * @param rules - the rules to place, already filtered
 */
export const groupRulesByDocument = ({ documents, rules }: Params): Array<{ document: StandardsPackDocumentView; rules: StandardsPackRuleListing[] }> => {
	const byId = new Map(rules.map((rule) => [rule.id, rule]));

	return documents
		.map((document) => ({
			document,
			rules: document.ruleIds.flatMap((id) => {
				const rule = byId.get(id);

				return rule === undefined ? [] : [rule];
			}),
		}))
		.filter((group) => group.rules.length > 0);
};
