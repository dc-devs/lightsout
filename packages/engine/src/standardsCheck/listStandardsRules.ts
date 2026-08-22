import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { StandardsRuleListing } from '#src/standardsCheck/common/types/StandardsRuleListing.ts';
import { resolvePackageRuleStates } from '#src/standardsCheck/resolvePackageRuleStates.ts';
import { resolveStandardsPacks } from '#src/standardsPacks/index.ts';

interface Params {
	cwd: string;
	config?: LightsoutConfig;
}

/**
 * Every rule the repo's standards packs bring, with the document that states
 * it, its summary, and the state it runs at here — sorted by rule id, so
 * `--list` output diffs cleanly.
 *
 * Judgment-only rules are listed beside the machine-checked ones: the ledger
 * answers "what does this repo enforce?", and a rule nobody can find out about
 * is a rule nobody follows.
 *
 * @param cwd - the repo whose packs and config are read
 * @param config - the repo's config; absent means the bundled default pack at its own defaults
 * @throws {Error} When a declared standards pack cannot be loaded, or the config names a rule no pack declares.
 */
export const listStandardsRules = async ({ cwd, config }: Params): Promise<StandardsRuleListing[]> => {
	const packs = await resolveStandardsPacks({ cwd, config });
	const states = resolvePackageRuleStates({ packs, config });
	const listings: StandardsRuleListing[] = [];

	for (const pack of packs) {
		for (const rule of pack.rules) {
			const state = states.get(rule.id);

			// Every loaded rule gets a state resolved for it, so this skips nothing
			// in practice — it is what keeps a rule from ever being listed with a
			// state nobody resolved.
			if (state === undefined) {
				continue;
			}

			listings.push({
				rule: rule.id,
				doc: `${pack.name}: ${rule.documentPath}`,
				summary: rule.summary,
				checked: rule.checked,
				severity: state.severity,
				fromConfig: state.fromConfig,
				settings: state.settings,
			});
		}
	}

	return listings.sort((first, second) => first.rule.localeCompare(second.rule));
};
