import { StandardsSet } from '@lightsout/standards-contracts';
import { z } from 'zod';

/** One document folder as a pack's page groups its rules — the header, its intro, and what sits under it. */
export const StandardsPackDocumentView = z.object({
	set: z.enum(StandardsSet),
	path: z.string(),
	channel: z.string(),
	/** document.md body — the group header's collapsible intro. */
	intro: z.string(),
	/** Rule ids in assembly order. */
	ruleIds: z.array(z.string()),
});

export type StandardsPackDocumentView = z.infer<typeof StandardsPackDocumentView>;
