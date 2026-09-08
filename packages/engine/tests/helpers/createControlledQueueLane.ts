import type { TicketRunOutcome } from '#src/queue/index.ts';

/** Tasks the test finishes by hand: each records that it started and then waits to be released. */
export const createControlledQueueLane = ({ enter, leave }: { enter: () => void; leave: () => void }) => {
	const started: string[] = [];
	const waiting = new Map<string, (outcome: TicketRunOutcome) => void>();
	let peak = 0;

	const begin = ({ identifier }: { identifier: string }) =>
		new Promise<TicketRunOutcome>((resolve) => {
			started.push(identifier);
			waiting.set(identifier, resolve);
			peak = Math.max(peak, waiting.size);
			enter();
		});

	const release = ({ identifier, outcome }: { identifier: string; outcome: TicketRunOutcome }) => {
		const resolve = waiting.get(identifier);

		if (resolve === undefined) {
			throw new Error(`${identifier} is not running on this lane, so there is nothing to release`);
		}

		waiting.delete(identifier);
		leave();
		resolve(outcome);
	};

	/**
	 * Yield timer turns until the drain has begun this ticket on the lane.
	 *
	 * A ticket reaches a lane only after work the lanes cannot see — the drain's
	 * queue-document write at startup and after every admission, on the thread
	 * pool — so no count of quiet turns can stand in for it: on a loaded machine
	 * the write outlasts the quiet, and a release issued before the start would
	 * release nothing. Waiting for the start itself is the only wait that cannot
	 * lose that race; the cap keeps a drain that never starts the ticket to a
	 * bounded, named failure rather than the suite's timeout.
	 */
	const untilStarted = async ({ identifier }: { identifier: string }) => {
		for (let turn = 0; turn < 4000 && !started.includes(identifier); turn += 1) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		if (!started.includes(identifier)) {
			throw new Error(`${identifier} never started on this lane`);
		}
	};

	return { begin, peak: () => peak, release, running: () => [...waiting.keys()], started: () => [...started], untilStarted };
};
