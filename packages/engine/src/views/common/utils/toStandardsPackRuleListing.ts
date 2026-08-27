import type { StandardsPackRuleListing } from '#src/contracts/index.ts';

interface Params {
	rule: Omit<StandardsPackRuleListing, 'fixtureCounts'>;
	fixtureCounts: StandardsPackRuleListing['fixtureCounts'];
}

/**
 * One rule's row: what the rule is, without the prose and the fixture text that
 * make a payload heavy.
 *
 * Written once and used from both ends of the read — the loaded rule folded into
 * a bundle, and that bundle projected down for a pack page — so the two can never
 * disagree about which fields a row carries.
 *
 * The counts arrive separately because only one caller has them to hand: the fold
 * counts the fixture files it just read, while the projection copies the counts
 * the fold already recorded.
 *
 * @param rule - anything carrying the rule's own facts, a loaded rule folder included
 * @param fixtureCounts - how many files each fixture side holds
 */
export const toStandardsPackRuleListing = ({ rule, fixtureCounts }: Params): StandardsPackRuleListing => ({
	id: rule.id,
	set: rule.set,
	documentPath: rule.documentPath,
	summary: rule.summary,
	channel: rule.channel,
	checked: rule.checked,
	defaultSeverity: rule.defaultSeverity,
	defaultSettings: rule.defaultSettings,
	fixtureCounts,
});
