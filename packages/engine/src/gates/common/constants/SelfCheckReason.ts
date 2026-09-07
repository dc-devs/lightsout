/**
 * Why one self-check ended as it did.
 *
 * Only `Ran` carries a gate verdict; the other three each print an ending of
 * their own, none of them is a failure of the change, and none of them may read
 * as a check that passed.
 */
export const SelfCheckReason = {
	/** Gates were scheduled and executed — the only reason whose result says anything about the code. */
	Ran: 'ran',
	/** The tree holds no change yet, so there was nothing to check. */
	NothingChanged: 'nothing-changed',
	/** The checkpoint this step precedes schedules no gates, or every package in scope skipped the ones it does. */
	NothingScheduled: 'nothing-scheduled',
	/** The engine could not work out what to check, because reading the repository's git status failed. */
	Unavailable: 'unavailable',
} as const;

export type SelfCheckReason = (typeof SelfCheckReason)[keyof typeof SelfCheckReason];
