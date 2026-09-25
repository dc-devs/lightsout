import type { StandardsPackRuleListing } from '@lightsout/engine';

interface Params {
	rule: StandardsPackRuleListing;
}

/**
 * Whether one rule still carries the examples that prove it.
 *
 * False for the copy the plugin ships, whose fixtures the bundler strips, and
 * for a rule authored without any. Two places ask, and each does something
 * different with the answer: the pack asks it of every rule at once, and a rule
 * row asks it of itself before deciding whether the server has any text to send.
 *
 * @param rule - one rule the pack holds
 */
export const hasRuleFixtures = ({ rule }: Params): boolean => rule.fixtureCounts.pass > 0 || rule.fixtureCounts.fail > 0;
