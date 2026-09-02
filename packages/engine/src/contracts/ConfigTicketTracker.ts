import { z } from 'zod';

/**
 * The optional `ticket-tracker` block of `lightsout.config.json` — who the
 * engine talks to about tickets, and how it authenticates.
 *
 * Tracker identity is one fact, spelled once. It sits above `queue` rather than
 * inside it because the queue is no longer its only reader: publishing a plan to
 * its ticket needs a team and a key without needing a queue at all, and two
 * spellings of one fact would let those callers disagree about which team a
 * ticket lives on.
 *
 * `.strict()` for the same reason `ConfigShip` is strict: the rest of the config
 * strips unknown keys, and a typo here would silently disable a setting the user
 * believes is active.
 */
export const ConfigTicketTracker = z
	.object({
		/** Which tracker the engine talks to. Only Linear has an adapter today. */
		provider: z.literal('linear'),
		/** The tracker's team key, e.g. 'LO' — every query is scoped to it. */
		team: z.string(),
		/** Name of the environment variable holding the tracker API key. The key itself is never written to config. */
		'api-key-env': z.string(),
	})
	.strict();

export type ConfigTicketTracker = z.infer<typeof ConfigTicketTracker>;
