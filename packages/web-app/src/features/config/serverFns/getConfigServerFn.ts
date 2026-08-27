import { ConfigNotFoundError } from '@lightsout/engine';
import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getReader } from '#src/lightsout/index.ts';

/**
 * What this repo told lightsout, and what lightsout filled in.
 *
 * Only the missing file becomes a 404, and it is turned into one here, on the
 * server, where the engine's error is still an instance — a class cannot survive
 * the trip across the server-function wire. A config that exists and will not
 * parse travels as itself, so the route's error boundary can show the message
 * that says which key is wrong, which is the only thing that fixes it.
 */
export const getConfigServerFn = createServerFn({ method: 'GET' }).handler(async () => {
	try {
		return await getReader().getConfig();
	} catch (error) {
		if (error instanceof ConfigNotFoundError) {
			throw notFound();
		}

		throw error;
	}
});
