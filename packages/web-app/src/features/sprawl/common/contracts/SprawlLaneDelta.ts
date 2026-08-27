import { z } from 'zod';
import { SprawlFile } from '#src/features/sprawl/common/contracts/SprawlFile.ts';
import { SprawlFolder } from '#src/features/sprawl/common/contracts/SprawlFolder.ts';

/**
 * One lane at one frame, carried as a change against the frame before it.
 *
 * A snapshot per frame — every file with its line count, twice, for hundreds of
 * commits — is megabytes shipped to the homepage. Deltas carry only what moved,
 * which keeps the committed dataset in the low hundreds of kilobytes.
 */
export const SprawlLaneDelta = z.object({
	/** Files whose line count changed since the previous frame, plus new files; removals travel out-of-band (see `removedFiles`). The first frame carries every file. */
	files: z.array(SprawlFile),
	/** Folders whose direct-entry count changed; removals travel out-of-band (see `removedFolders`). The first frame carries every folder. */
	folders: z.array(SprawlFolder),
	/** Paths present in the previous frame's state and gone from this one. Never overlaps `files`. Empty on the first frame. */
	removedFiles: z.array(z.string()),
	/** Folder paths present in the previous frame's state and gone from this one. Never overlaps `folders`. Empty on the first frame. */
	removedFolders: z.array(z.string()),
	/** Files over the file cap in this lane at this frame — counted on the full state, not the delta. */
	overCap: z.number(),
});

export type SprawlLaneDelta = z.infer<typeof SprawlLaneDelta>;
