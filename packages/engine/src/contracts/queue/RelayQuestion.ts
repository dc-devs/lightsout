import { z } from 'zod';

/**
 * One question waiting in the file-relay mailbox.
 *
 * Written by the queue, read by whoever is draining the mailbox — the plugin's
 * queue skill, or a person with an editor. Everything a reader needs to decide
 * an answer is in the file, so nothing has to be correlated with the queue's
 * stdout.
 */
export const RelayQuestion = z.object({
	/** The ticket's human reference, e.g. 'LO-70'. */
	ticket: z.string(),
	/** The ticket title, so a reader has context without opening the tracker. */
	title: z.string(),
	question: z.string(),
	/** ISO timestamp the question was written, for judging how stale it is. */
	askedAt: z.string(),
});

export type RelayQuestion = z.infer<typeof RelayQuestion>;
