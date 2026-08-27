import { z } from 'zod';
import { SprawlFrame } from '#src/features/sprawl/common/contracts/SprawlFrame.ts';

/**
 * This repository's own history, measured once by `scripts/buildSprawlDataset.mjs`
 * and committed to `assets/sprawl-dataset.json`.
 *
 * Every number in it is read from git and from the standards pack's own rule
 * settings — nothing here is typed in by hand, and nothing here is invented.
 */
export const SprawlDataset = z.object({
	/** The commit the dataset was built at — the last frame's sha, so a rebuild at the same HEAD is byte-identical. */
	headSha: z.string(),
	/** Caps read from the pack, never typed in. */
	caps: z.object({ file: z.number(), tsxFile: z.number(), function: z.number(), testFile: z.number(), folderCensus: z.number() }),
	/** How many commits the 400-frame cap dropped; 0 normally. */
	droppedCommits: z.number(),
	frames: z.array(SprawlFrame),
});

export type SprawlDataset = z.infer<typeof SprawlDataset>;
