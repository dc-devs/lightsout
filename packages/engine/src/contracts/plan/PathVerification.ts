import { z } from 'zod';

/**
 * The deterministic result of re-checking the authored facts' claims on disk
 * — counts plus the miss lists. An agent claiming "path exists" is not
 * evidence; `stat`/package.json reads in code are. Verification results are
 * data, never thrown.
 */
export const PathVerification = z.object({
	pathsChecked: z.number(),
	missingPaths: z.array(z.string()).default([]),
	scriptsChecked: z.number(),
	missingScripts: z.array(z.string()).default([]),
	/** Create-paths that already exist (populated in Phase 2's draft; empty here). */
	createPathsThatExist: z.array(z.string()).default([]),
});

export type PathVerification = z.infer<typeof PathVerification>;
