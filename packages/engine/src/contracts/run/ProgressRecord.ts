import { z } from 'zod';

/**
 * One line a run narrated, as persisted to the run directory's progress.jsonl.
 *
 * A detached run's narration used to exist only in the terminal that started
 * it. Persisting it is what lets a reader — the progress view's `now` line —
 * say what a run is doing right now without a process to tail.
 */
export const ProgressRecord = z.object({
	/** ISO timestamp the line was narrated. */
	at: z.string(),
	/** The line exactly as the run narrated it, unformatted. */
	message: z.string(),
});

export type ProgressRecord = z.infer<typeof ProgressRecord>;
