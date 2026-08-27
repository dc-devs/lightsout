import type { StandardsPackRuleView } from '#src/contracts/index.ts';
import { toStandardsPackRuleView } from '#src/views/common/utils/toStandardsPackRuleView.ts';
import { getStandardsPackBundle } from '#src/views/getStandardsPackBundle.ts';

interface Params {
	cwd: string;
	name: string;
	rule: string;
}

/**
 * One rule of one pack, with its prose and the files that prove it.
 *
 * Fetched a rule at a time rather than with the pack, because a pack's fixture
 * text runs to megabytes and a page shows one rule's worth of it at once.
 *
 * @param cwd - the repo whose config decides which packs load
 * @param name - the pack's `name` from its lightsout-standards.json, which is what the URL carried
 * @param rule - the rule id the URL carried, as its folder name spells it minus the numeric prefix
 * @throws {StandardsPackNotFoundError} When no pack this repo loads answers to the name.
 * @throws {StandardsPackRuleNotFoundError} When the pack holds no rule of that id.
 */
export const getStandardsPackRuleView = async ({ cwd, name, rule }: Params): Promise<StandardsPackRuleView> => {
	const bundle = await getStandardsPackBundle({ cwd, name });

	return toStandardsPackRuleView({ bundle, rule });
};
