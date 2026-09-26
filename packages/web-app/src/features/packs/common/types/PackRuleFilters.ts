import type { StandardsSet, StandardsSeverity } from '@lightsout/engine/contracts';
import type { CheckKind } from '#src/common/constants/CheckKind.ts';

/**
 * What a reader has narrowed a pack's rule list to.
 *
 * Every key is optional and an absent key means "do not narrow on this", which
 * is what lets the whole object be written straight into the URL — a filter
 * cleared to `undefined` simply drops out of the query string.
 *
 * `check` uses the same two words the pages and the address do, so a filter
 * travels from the URL to the list without being translated on the way.
 */
export interface PackRuleFilters {
	set?: StandardsSet;
	channel?: string;
	/** Deterministic or agent checks only; undefined = both. */
	check?: CheckKind;
	/** A rule ships blocking or advisory; `off` is a repo's own choice and never a pack's default. */
	severity?: typeof StandardsSeverity.Blocking | typeof StandardsSeverity.Advisory;
	text?: string;
}
