import { z } from 'zod';

/**
 * One answer, written beside the question it answers.
 *
 * An object rather than a bare string so the file is self-describing and can
 * grow a field later without breaking every reader.
 */
export const RelayAnswer = z.object({
	answer: z.string(),
});

export type RelayAnswer = z.infer<typeof RelayAnswer>;
