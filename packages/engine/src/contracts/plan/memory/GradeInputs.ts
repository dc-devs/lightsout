import { z } from 'zod';
import { GradeDecisionLog } from '#src/contracts/plan/memory/GradeDecisionLog.ts';

/**
 * The fingerprint of everything one grading pass measured. Two passes whose
 * combined `sha256` agree read the same inputs, which is what lets a recorded
 * passing review be reported as current instead of paid for again.
 *
 * `effort` is a plain string rather than the `Effort` enum so a memory written
 * under a value the enum later drops still parses; the field is only ever
 * compared for equality, never interpreted.
 */
export const GradeInputs = z.object({
	/**
	 * One entry per plan file, overview included, keyed by basename and sorted by
	 * it. `designSha256` is the hash of the text a reader of that file actually
	 * read — its content with every engine-generated region removed and the
	 * overview text credited to it hashed in. Absent means nobody measured it,
	 * which is an entry recorded before design hashes existed or a plan file that
	 * could not be read, and it never compares equal to a present one.
	 */
	planFiles: z.array(z.object({ file: z.string(), sha256: z.string(), designSha256: z.string().optional() })).default([]),
	/** `HEAD` when the pass ran; absent outside a git worktree. */
	gradedCommit: z.string().optional(),
	/**
	 * Every modified or untracked working-tree file with the sha256 of its
	 * content, sorted by path. A path that cannot be read carries the literal
	 * `absent`. Absent altogether when the git probe did not run — which is NOT
	 * an empty list, and never compares equal to anything.
	 */
	changedFiles: z.array(z.object({ path: z.string(), sha256: z.string() })).optional(),
	/** sha256 of the supplemental standards text; absent when no standards were threaded in. */
	standards: z.string().optional(),
	/** sha256 of the canonical JSON of the plan-relevant config keys. */
	config: z.string(),
	/** sha256 of the prompt texts that shape a pass — the reader brief, its three lens briefs, the judge brief, the documentation brief and the re-verification brief, in that order. */
	prompts: z.string(),
	model: z.string().optional(),
	effort: z.string().optional(),
	/** Present for every plan whose decisions were read; absent for a pass recorded before the field existed. Read only by the scope comparison. */
	decisionLog: GradeDecisionLog.optional(),
	/** sha256 over the canonical JSON of every field above — the one value a comparison uses. */
	sha256: z.string(),
});

export type GradeInputs = z.infer<typeof GradeInputs>;
