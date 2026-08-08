import type { StandardsRule } from '@/contracts';
import { codeRuleDefinitions } from '@/standardsCheck/common/constants/codeRuleDefinitions';
import { testRuleDefinitions } from '@/standardsCheck/common/constants/testRuleDefinitions';
import type { StandardsRuleDefinition } from '@/standardsCheck/common/types/StandardsRuleDefinition';

/**
 * Every rule the standards check enforces, as data: the doc it comes from, its
 * default severity, the pass that produces it and that rule's own numeric
 * knobs. Imports no pass function, so `--list` and the config resolver can read
 * the whole ledger without loading the compiler-gated passes.
 *
 * The entries themselves live in two halves, split by the standards document
 * they cite — `codeRuleDefinitions` for `standards/code/…`, `testRuleDefinitions`
 * for `standards/tests/…`. Adding a rule is still one entry plus one line in
 * the pass that emits it, and which half takes the entry is read off its `doc`.
 *
 * The annotation here is what enforces the ledger: a rule added to the contract
 * with no entry in either half, or an entry whose shape has drifted, fails to
 * compile on this line.
 */
export const standardsRuleRegistry: Record<StandardsRule, StandardsRuleDefinition> = {
	...codeRuleDefinitions,
	...testRuleDefinitions,
};
