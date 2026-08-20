import { RunNotFoundError } from '@lightsout/engine';
import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { toRunDetailView } from '#src/features/runDetail/common/utils/toRunDetailView.ts';
import { getReader } from '#src/lightsout/index.ts';

/**
 * One run's whole evidence, by id.
 *
 * An id nothing on disk answers to becomes the router's own not-found signal
 * here, on the server, where the engine's error is still an instance: a class
 * cannot survive the trip across the server-function wire, so matching one on
 * the other side would be matching a message. Every other failure travels as
 * itself.
 */
export const getRunServerFn = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ runId: z.string().min(1) }))
	.handler(async ({ data }) => {
		try {
			return toRunDetailView({ view: await getReader().getRun({ runId: data.runId }) });
		} catch (error) {
			if (error instanceof RunNotFoundError) {
				throw notFound();
			}

			throw error;
		}
	});
