import { notFound } from '@tanstack/react-router';

/** An engine error class meaning "nothing answers to that address" — always constructed with the name or id the URL carried. */
type AbsenceError = new (...args: never[]) => Error;

interface Params<TResult> {
	/** The reader call the route is making. */
	read: () => Promise<TResult>;
	/** The engine errors that mean the address was wrong rather than that something broke. */
	absent: AbsenceError[];
}

/**
 * Reads through the reader, turning "no such thing" into the router's own
 * not-found signal and letting every other failure travel as itself.
 *
 * The mapping happens on the server, while the engine's error is still an
 * instance: a class cannot survive the trip across the server-function wire, so
 * matching one on the other side would be matching a message. That is why every
 * route serving a named record hands its reader call here rather than catching
 * in the component.
 */
export const readOrNotFound = async <TResult>({ read, absent }: Params<TResult>): Promise<TResult> => {
	try {
		return await read();
	} catch (error) {
		if (absent.some((Absence) => error instanceof Absence)) {
			throw notFound();
		}

		throw error;
	}
};
