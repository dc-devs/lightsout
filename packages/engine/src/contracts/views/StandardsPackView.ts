import { z } from 'zod';
import { StandardsPackDocumentView } from '#src/contracts/views/StandardsPackDocumentView.ts';
import { StandardsPackListing } from '#src/contracts/views/StandardsPackListing.ts';
import { StandardsPackRuleListing } from '#src/contracts/views/StandardsPackRuleListing.ts';

/**
 * The pack page's payload: the listing plus its documents and every rule's
 * listing row. No prose and no fixture text — those arrive one rule at a time.
 */
export const StandardsPackView = StandardsPackListing.extend({
	documents: z.array(StandardsPackDocumentView),
	rules: z.array(StandardsPackRuleListing),
});

export type StandardsPackView = z.infer<typeof StandardsPackView>;
