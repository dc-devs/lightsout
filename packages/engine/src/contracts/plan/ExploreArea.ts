import { z } from 'zod';

/**
 * One explorer agent's facts for one area of a feature: the packages it
 * touches, the files to modify (with a one-line role), the patterns to mirror,
 * the integration points (real signatures + locations), the relevant scripts,
 * and the naming convention. Data, not file contents — the paths are what the
 * engine then verifies on disk. Array fields default to empty so a sparse
 * report still parses at the contract boundary.
 */
export const ExploreArea = z.object({
	/** The area of the feature this explorer focused on. */
	area: z.string(),
	/** Packages the area touches (repo-relative dirs — used to scope script checks). */
	affectedPackages: z.array(z.string()).default([]),
	filesToModify: z
		.array(
			z.object({
				path: z.string(),
				/** One line — what this file's role is in the change. */
				role: z.string(),
			}),
		)
		.default([]),
	patternsToMirror: z
		.array(
			z.object({
				path: z.string(),
				/** What to take from this file when writing the analogous code. */
				takeaway: z.string(),
			}),
		)
		.default([]),
	integrationPoints: z
		.array(
			z.object({
				name: z.string(),
				/** The real signature the new code integrates against. */
				signature: z.string(),
				/** Where it lives, file:line. */
				at: z.string(),
			}),
		)
		.default([]),
	scripts: z
		.array(
			z.object({
				/** package.json script key (e.g. 'check', 'test-unit'). */
				key: z.string(),
				command: z.string(),
			}),
		)
		.default([]),
	/** One line — the naming convention the area follows. */
	namingConvention: z.string(),
});

export type ExploreArea = z.infer<typeof ExploreArea>;
