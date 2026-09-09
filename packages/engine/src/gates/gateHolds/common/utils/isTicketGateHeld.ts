import { gateBlockedLabel } from '#src/gates/gateHolds/common/constants/gateBlockedLabel.ts';
import type { GateHolds } from '#src/gates/gateHolds/common/types/GateHolds.ts';

interface Params {
	holds: GateHolds;
	identifier: string;
	/** The ticket's tracker labels, which every refusal site already has in hand. */
	labels: string[];
}

/**
 * Whether a ticket may not be started: the local record says it is held, OR its
 * tracker labels carry the blocked label.
 *
 * Each half closes the other's hole. The local record is what blocks when the
 * label write never landed; the label is what blocks when the local record was
 * lost — a failed write, or somebody clearing `.lightsout` in the primary
 * checkout. The pair costs nothing, because every refusal site already holds the
 * ticket's labels, and it is what makes the documented instruction — remove the
 * label to release — literally true rather than nearly true.
 *
 * One predicate on purpose: the parked scan, wave selection and the
 * command-edge guard must not answer this question three ways.
 */
export const isTicketGateHeld = ({ holds, identifier, labels }: Params): boolean =>
	holds[identifier.toLowerCase()] !== undefined || labels.includes(gateBlockedLabel);
