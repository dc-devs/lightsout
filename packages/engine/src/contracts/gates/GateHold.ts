import { z } from 'zod';

/**
 * One ticket's durable hold (`<primary checkout>/.lightsout/gate-holds/<ticket>.json`),
 * taken when a gate run stopped without ever getting the machine.
 *
 * One file per held ticket rather than one document, so a coordinator
 * reconciling holds and a worker taking one never write the same path: with a
 * shared document the worker's hold could simply vanish, which is the lost
 * write this record exists to prevent.
 */
export const GateHold = z.object({
	takenAt: z.string(),
	runId: z.string(),
	/** The checkout whose gates never started, left exactly where it is. */
	worktreePath: z.string(),
	/** The coordination sentence the wait expiry produced, so it reads the same wherever it surfaces. */
	reason: z.string(),
	/**
	 * Whether the tracker label write has landed. False means it never has, and a
	 * hold in that state is never read as released however the tracker looks —
	 * the absence of a label nobody applied is no evidence at all.
	 */
	labelConfirmed: z.boolean(),
});

export type GateHold = z.infer<typeof GateHold>;
