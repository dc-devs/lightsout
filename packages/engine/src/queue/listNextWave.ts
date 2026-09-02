import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { listEligibleTickets } from '#src/queue/listEligibleTickets.ts';
import { orderTickets } from '#src/queue/orderTickets.ts';
import { selectWaveTickets } from '#src/queue/selectWaveTickets.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	/** Lower-cased identifiers this invocation has already offered to a wave. */
	attempted: Set<string>;
	onProgress?: (message: string) => void;
}

/**
 * The tickets a later wave may take: the tracker re-read from scratch, so a
 * blocker that finished during the wave just gone is now visible as finished.
 *
 * Parked worktrees are deliberately not re-scanned — that happens once per
 * invocation, before the first wave.
 */
export const listNextWave = async ({ settings, trackerSettings, attempted, onProgress }: Params): Promise<WaveSelection | QueueFailure> => {
	const eligible = await listEligibleTickets({ settings, trackerSettings });

	if ('error' in eligible) {
		return eligible;
	}

	return selectWaveTickets({ tickets: orderTickets({ tickets: eligible }), settings, attempted, onProgress });
};
