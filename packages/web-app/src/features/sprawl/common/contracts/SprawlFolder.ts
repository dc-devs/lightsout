import { z } from 'zod';

/** One folder at one frame — a row of squares in the chart. */
export const SprawlFolder = z.object({
	/** Repo-relative folder path. */
	path: z.string(),
	/** Direct non-test files of any type, as the folder-census check counts them — no subfolders. */
	entries: z.number(),
});

export type SprawlFolder = z.infer<typeof SprawlFolder>;
