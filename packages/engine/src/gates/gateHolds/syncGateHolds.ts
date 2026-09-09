import { gateBlockedLabel } from '#src/gates/gateHolds/common/constants/gateBlockedLabel.ts';
import type { GateHolds } from '#src/gates/gateHolds/common/types/GateHolds.ts';
import { readGateHolds } from '#src/gates/gateHolds/common/utils/readGateHolds.ts';
import { removeGateHold } from '#src/gates/gateHolds/common/utils/removeGateHold.ts';
import { writeGateBlockedLabel } from '#src/gates/gateHolds/common/utils/writeGateBlockedLabel.ts';
import { writeGateHold } from '#src/gates/gateHolds/common/utils/writeGateHold.ts';
import { getTicketsByIdentifiers, type TrackerSettings, type TrackerTicket } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	settings: TrackerSettings;
	onProgress?: (message: string) => void;
}

/**
 * The holds still standing, with every release the tracker can prove applied.
 *
 * The release rule lives here and nowhere else. A hold whose label write was
 * confirmed clears when the ticket comes back and its labels no longer carry the
 * blocked label — nothing else counts as release. A tracker read that failed
 * keeps every hold, because reading a failure as release would drop every hold
 * on the machine during an outage; and a ticket the tracker does not return is
 * unknown rather than released, because a hold nobody can look up is one a
 * human still has to settle.
 *
 * A hold whose label write never succeeded has that write re-attempted here and
 * keeps blocking either way, with the failure reported every time until it
 * lands.
 *
 * Only the holds it changes are written back, so a worker recording a hold for
 * another ticket in the same moment is untouched. The empty short circuit is
 * load-bearing rather than an optimisation: a repository that has never timed
 * out makes no tracker call here at all.
 *
 * It reads and writes the tracker, so it is never called while a gate
 * reservation is held.
 */
export const syncGateHolds = async ({ cwd, settings, onProgress }: Params): Promise<GateHolds> => {
	const holds = await readGateHolds({ cwd });
	const identifiers = Object.keys(holds);

	if (identifiers.length === 0) {
		return holds;
	}

	const found = await getTicketsByIdentifiers({ settings, identifiers });

	if ('error' in found) {
		onProgress?.(`the gate holds could not be reconciled with the tracker, so every one of them still stands: ${found.error}`);

		return holds;
	}

	const byIdentifier = new Map<string, TrackerTicket>(found.map((ticket) => [ticket.identifier.toLowerCase(), ticket]));
	const standing: GateHolds = {};

	for (const [identifier, hold] of Object.entries(holds)) {
		const ticket = byIdentifier.get(identifier);

		if (hold.labelConfirmed) {
			if (ticket === undefined) {
				onProgress?.(`${identifier} · the tracker returned no such ticket, so its gate hold stands until a human settles it`);
			} else if (!ticket.labels.includes(gateBlockedLabel)) {
				await removeGateHold({ cwd, identifier });
				continue;
			}

			standing[identifier] = hold;
			continue;
		}

		const failure = await writeGateBlockedLabel({ settings, identifier });

		if (failure !== undefined) {
			onProgress?.(`${identifier} · ${failure}`);
			standing[identifier] = hold;
			continue;
		}

		const confirmed = { ...hold, labelConfirmed: true };

		await writeGateHold({ cwd, identifier, hold: confirmed });
		standing[identifier] = confirmed;
	}

	return standing;
};
