import { z } from 'zod';
import { StandardsPackFixture } from '#src/contracts/views/StandardsPackFixture.ts';
import { StandardsPackRuleListing } from '#src/contracts/views/StandardsPackRuleListing.ts';

/**
 * One rule whole — the listing plus its argument and its proof. What a rule page
 * or an expanded rule row fetches, one rule at a time, because a pack's fixture
 * text runs to megabytes and no page needs all of it at once.
 */
export const StandardsPackRuleView = StandardsPackRuleListing.extend({
	/** rule.md body; empty for the rules that state only a summary. */
	prose: z.string(),
	/** Every file under fixtures/pass and fixtures/fail, in path order; empty for a built pack. */
	fixtures: z.array(StandardsPackFixture),
});

export type StandardsPackRuleView = z.infer<typeof StandardsPackRuleView>;
