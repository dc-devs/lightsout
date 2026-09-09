import type { GateHold } from '#src/contracts/index.ts';
import { gateBlockedLabel } from '#src/gates/gateHolds/common/constants/gateBlockedLabel.ts';

interface Params {
	/** The local record, or undefined when only the tracker label says the ticket is held. */
	hold: GateHold | undefined;
	identifier: string;
}

/**
 * The one sentence every refusal site emits for a held ticket.
 *
 * Written once and exported because two modules in different folders emit it —
 * the rule `describeGateCrash` established, that one event gets one spelling.
 * Callers prefix it with the queue's own `${identifier} · ` skip-line shape and
 * never rewrite it.
 *
 * `hold` is optional because `isTicketGateHeld` deliberately answers true in a
 * second case: the ticket carries the blocked label while this machine holds no
 * record for it. That sentence invents no run, no worktree and no time it does
 * not have.
 */
export const describeGateHold = ({ hold, identifier }: Params): string => {
	if (hold === undefined) {
		return `on hold: ${identifier} carries the '${gateBlockedLabel}' label, and this machine holds no local record of when or why the hold was taken. Remove the label from the ticket to release it.`;
	}

	const unconfirmed = hold.labelConfirmed
		? ''
		: ` The '${gateBlockedLabel}' label write never landed on the tracker, so its absence from the ticket is not a release — this hold stands until the write succeeds and a human then removes it.`;

	return `on hold since ${hold.takenAt}: run ${hold.runId} in ${hold.worktreePath} stopped without judging the code — ${hold.reason} Remove the '${gateBlockedLabel}' label from ${identifier} to release it.${unconfirmed}`;
};
