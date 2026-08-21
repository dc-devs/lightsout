import { readConfig } from '#src/common/config/readConfig.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { listStandardsRules, type StandardsRuleListing } from '#src/standardsCheck/index.ts';

interface Params {
	cwd: string;
}

/**
 * The repo's config and the rule ledger it resolves to — the pair every path
 * of the standards check starts from. A repo without a config still has an
 * answer (every rule at its default), so a missing config is tolerated here;
 * a ledger that cannot be built is not, and the rejection carries the loader's
 * own message naming the package at fault.
 */
export const loadStandardsLedger = async ({ cwd }: Params): Promise<{ config?: LightsoutConfig; rules: StandardsRuleListing[] }> => {
	const config = await readConfig({ cwd }).catch(() => undefined);
	const rules = await listStandardsRules({ cwd, config });

	return { config, rules };
};
