import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { listStandardsRules, type StandardsRuleListing } from '#src/standardsCheck/index.ts';

interface Params {
	cwd: string;
}

/**
 * The repo's config and the rule ledger it resolves to — the pair every path
 * of the standards check starts from. A repo without a config still has an
 * answer (every rule at its default), so a missing config is tolerated here;
 * a ledger that cannot be built is not, and the rejection carries the package reader's
 * own message naming the package at fault.
 */
export const readStandardsLedger = async ({ cwd }: Params): Promise<{ config?: LightsoutConfig; rules: StandardsRuleListing[] }> => {
	const config = await readOptionalConfig({ cwd });
	const rules = await listStandardsRules({ cwd, config });

	return { config, rules };
};
