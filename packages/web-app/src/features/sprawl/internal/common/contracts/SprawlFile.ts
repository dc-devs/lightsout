import { z } from 'zod';

/** One file at one frame — a bar in the chart. */
export const SprawlFile = z.object({
	/** Repo-relative path. */
	path: z.string(),
	/** Line count at this frame. */
	lines: z.number(),
});

export type SprawlFile = z.infer<typeof SprawlFile>;
