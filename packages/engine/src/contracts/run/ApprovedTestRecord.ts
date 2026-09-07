import { z } from 'zod';

/**
 * One test-side path whose approved version is not simply its content at
 * `HEAD`: either the run holds an approved copy of it, or the run has approved
 * its absence.
 *
 * Exactly one of `sha256` and a true `removed` is set. `approveTestFiles` is
 * the only writer, and it is what upholds that.
 */
export const ApprovedTestRecord = z.object({
	/** Repo-relative path of the test-side file. */
	path: z.string().min(1),
	/** SHA-256 of the approved copy under the run's approved directory. Absent on an approved removal. */
	sha256: z.string().length(64).optional(),
	/** True when the approved state of this path is "not in the tree" — no copy exists and none is expected. */
	removed: z.boolean().default(false),
});

export type ApprovedTestRecord = z.infer<typeof ApprovedTestRecord>;
