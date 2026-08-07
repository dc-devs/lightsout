import { appendFile } from 'node:fs/promises';

interface Params {
	/** File the events are appended to, one JSON line per event. */
	path: string;
	/** Work that must finish before the first append — typically creating the directory. */
	ready?: Promise<unknown>;
}

/**
 * A sink that appends each event to `path` as one JSON line, in arrival order.
 *
 * The sink returns synchronously because a driver's read loop calls it inline,
 * so the appends are chained through a promise tail instead of awaited. Without
 * that chain the writes race and events land out of order, which stops the
 * transcript being usable as the run's evidence. Write failures are swallowed:
 * evidence is best-effort and must never fail a run, and a failed append leaves
 * the tail resolved so later events still land. `ready` is caught on the way in
 * for the same reason — a sink whose directory could not be created must not
 * wedge, and must not raise an unhandled rejection when no event ever arrives.
 */
export const createEventFileSink = ({ path, ready }: Params): ((event: unknown) => void) => {
	let tail: Promise<unknown> = ready ? ready.catch(() => undefined) : Promise.resolve();

	return (event: unknown) => {
		tail = tail.then(() => appendFile(path, `${JSON.stringify(event)}\n`, 'utf8')).catch(() => undefined);
	};
};
