import { z } from 'zod';
import { SprawlLaneDelta } from '#src/features/sprawl/common/contracts/SprawlLaneDelta.ts';

/** One commit, as both lanes saw it. */
export const SprawlFrame = z.object({
	/** Short commit sha. */
	sha: z.string(),
	/** ISO commit date. */
	at: z.string(),
	/** First line of the commit subject. */
	subject: z.string(),
	/** A refactor run finished at this commit — where a move is allowed to happen. */
	isRefactorMarker: z.boolean(),
	/** With lightsout: the tree as it actually was, as a delta from the previous frame. */
	with: SprawlLaneDelta,
	/** Without: the same work, graduations and consolidations undone, as a delta. */
	without: SprawlLaneDelta,
});

export type SprawlFrame = z.infer<typeof SprawlFrame>;
