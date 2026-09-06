import type { LaneFlight } from '#src/queue/drainLanes/common/types/LaneFlight.ts';

interface Params {
	flight: LaneFlight;
	/** The task's whole life, effects included. It settles rather than rejects: a rejection reaching the race would abandon the drain. */
	run: () => Promise<void>;
}

/** Put a task in flight under a rising key it resolves to, so the drain's race says which one finished. */
export const trackTask = ({ flight, run }: Params): void => {
	const key = flight.nextKey;

	flight.nextKey += 1;
	flight.tasks.set(
		key,
		run().then(() => key),
	);
};
