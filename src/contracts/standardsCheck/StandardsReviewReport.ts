import { z } from 'zod';

/**
 * The standards reviewer's output: violations of the judgment-only rules it
 * was given, each tied to a file.
 *
 * `rule` is a free string because the contract cannot know which rules a repo
 * loaded — the ids are validated against the loaded packages after parsing, so
 * an id no package declares is dropped rather than trusted. Site keys are not
 * asked for: the engine derives them, which is what keeps a reviewed finding
 * addressable by the same key everything else uses.
 */
export const StandardsReviewReport = z.object({
	findings: z.array(
		z.object({
			/** A judgment rule's id — validated against the loaded packages after parsing. */
			rule: z.string(),
			files: z.array(z.object({ path: z.string(), startLine: z.number().optional(), endLine: z.number().optional() })),
			detail: z.string(),
			guidance: z.string().optional(),
		}),
	),
});

export type StandardsReviewReport = z.infer<typeof StandardsReviewReport>;
