import { z } from 'zod';
import { ShipBlockReason } from '#src/contracts/ship/ShipBlockReason.ts';
import { ShipStatus } from '#src/contracts/ship/ShipStatus.ts';

/**
 * What one `lightsout ship` attempt did, written to
 * `.lightsout/ship/<branch>.json` on every exit path.
 *
 * This is the hand-off the whole command exists to produce: the engine knows
 * "ticket reference" and nothing about any tracker, so a swappable skill reads
 * this file and posts wherever the team's tracker lives. Every exit writes one,
 * blocked included — a skill that finds no file cannot tell "ship never ran"
 * from "ship ran and stopped".
 *
 * Every field beyond `status` is optional because a precondition block knows
 * little, and a `GitUnreadable` block not even the branch name. A shipped
 * result always carries `ticketRef`, `prNumber`, `prUrl`, `prTitle`,
 * `mergeCommit` and `mergedAt`; that is stated here rather than in the type, so
 * one schema parses both outcomes and no reader is handed a half-populated
 * union.
 */
export const ShipResult = z.object({
	status: z.enum(ShipStatus),
	/** Branch shipped, as git names it. Absent only when git itself was unreadable before a branch name was known. */
	branch: z.string().optional(),
	/** The `ticket` capture group of the configured pattern, e.g. 'lo-60'. Absent when the branch did not match. */
	ticketRef: z.string().optional(),
	prNumber: z.number().optional(),
	prUrl: z.string().optional(),
	/** The pull request's title — the "what shipped" line a tracker comment quotes. */
	prTitle: z.string().optional(),
	/** Commit the merge produced on the default branch. */
	mergeCommit: z.string().optional(),
	/** ISO timestamp of the merge. */
	mergedAt: z.string().optional(),
	/** Present exactly when status is 'blocked'. */
	reason: z.enum(ShipBlockReason).optional(),
	/**
	 * One human-readable sentence naming what stopped it. When the step that
	 * stopped it ran a command, the sentence is followed by a colon and that
	 * command's output — trimmed, and capped at a few hundred characters, since
	 * this is a hand-off a tracker skill quotes rather than a log.
	 */
	detail: z.string().optional(),
	/** Named checks that finished red or never finished — filled for 'checks-failed' and 'checks-timed-out'. */
	failingChecks: z.array(z.string()).default([]),
});

export type ShipResult = z.infer<typeof ShipResult>;
