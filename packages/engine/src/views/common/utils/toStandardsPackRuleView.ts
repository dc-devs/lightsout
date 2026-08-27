import type { StandardsPackBundle, StandardsPackRuleView } from '#src/contracts/index.ts';
import { StandardsPackRuleNotFoundError } from '#src/views/StandardsPackRuleNotFoundError.ts';

interface Params {
	bundle: StandardsPackBundle;
	rule: string;
}

/**
 * One rule of a pack, whole — its argument and every file that proves it.
 *
 * @param bundle - the pack read whole
 * @param rule - the rule id to pull out of it, as its folder name spells it minus the numeric prefix
 * @throws {StandardsPackRuleNotFoundError} When no rule in the bundle carries the id.
 */
export const toStandardsPackRuleView = ({ bundle, rule }: Params): StandardsPackRuleView => {
	const found = bundle.rules.find((entry) => entry.id === rule);

	if (found === undefined) {
		throw new StandardsPackRuleNotFoundError({ name: bundle.name, rule });
	}

	return found;
};
