import type { StandardsPackRuleListing } from '@lightsout/engine';

interface Params {
	rules: StandardsPackRuleListing[];
}

/**
 * Every rule that ships a number, with the numbers it ships.
 *
 * These are the caps — lines per file, files per folder, exports per module —
 * and they are read off the pack rather than typed into the page, so tuning one
 * in the pack changes what the page says about it.
 *
 * @param rules - every rule the pack holds
 */
export const getCapRules = ({ rules }: Params): Array<{ id: string; settings: Array<{ name: string; value: number }> }> =>
	rules
		.map((rule) => ({ id: rule.id, settings: Object.entries(rule.defaultSettings).map(([name, value]) => ({ name, value })) }))
		.filter((rule) => rule.settings.length > 0);
