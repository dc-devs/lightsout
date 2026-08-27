import type { StandardsSet, StandardsSeverity } from '@lightsout/engine/contracts';

/**
 * What a reader has narrowed a pack's rule list to.
 *
 * Every key is optional and an absent key means "do not narrow on this", which
 * is what lets the whole object be written straight into the URL — a filter
 * cleared to `undefined` simply drops out of the query string.
 *
 * `checked` is a boolean rather than the URL's own `code`/`judgment` wording:
 * the rule listing carries a boolean, and the route is the one place that
 * translates between the two.
 */
export interface PackRuleFilters {
	set?: StandardsSet;
	channel?: string;
	/** true = enforced by code, false = judgment, undefined = both. */
	checked?: boolean;
	/** A rule ships blocking or advisory; `off` is a repo's own choice and never a pack's default. */
	severity?: typeof StandardsSeverity.Blocking | typeof StandardsSeverity.Advisory;
	text?: string;
}
