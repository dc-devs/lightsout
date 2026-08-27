import { z } from 'zod';
import { StandardsPackDocumentView } from '#src/contracts/views/StandardsPackDocumentView.ts';
import { StandardsPackListing } from '#src/contracts/views/StandardsPackListing.ts';
import { StandardsPackRuleView } from '#src/contracts/views/StandardsPackRuleView.ts';

/**
 * The whole pack, every rule with its prose and fixture text — what the engine
 * reads from disk once, and what a stateless build bundles for the default pack.
 *
 * Never sent over the wire whole: the listing, the view and the rule view are
 * projections of it. About two megabytes for the default pack.
 */
export const StandardsPackBundle = StandardsPackListing.extend({
	documents: z.array(StandardsPackDocumentView),
	rules: z.array(StandardsPackRuleView),
});

export type StandardsPackBundle = z.infer<typeof StandardsPackBundle>;
