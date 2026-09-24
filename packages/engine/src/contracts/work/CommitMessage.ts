import { z } from 'zod';

/**
 * The commit-message agent's output contract: the one line that closes a
 * commit's subject, and an optional body.
 *
 * The shape lives here rather than only in the role prompt because this is what
 * the engine can enforce. A chatty answer, a second line, or a summary too long
 * for a subject is rejected at the boundary, the re-emit rung retries once, and
 * a second failure falls back to the caller's template subject — so an answer
 * the engine cannot turn into a subject never reaches a commit.
 */
export const CommitMessage = z.object({
	/** One line of 1 to 64 characters saying what the staged change does. */
	summary: z
		.string()
		.min(1, 'a commit summary says what the change does in at least one character')
		.max(64, 'a commit summary is at most 64 characters')
		.regex(/^[^\r\n]*$/u, 'a commit summary is one line, with no line break'),
	/** Optional plain prose, at most 1200 characters. */
	body: z.string().max(1200, 'a commit body is at most 1200 characters').optional(),
});

export type CommitMessage = z.infer<typeof CommitMessage>;
