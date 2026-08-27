import { StandardsPackNotFoundError } from '@lightsout/engine';
import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getReader } from '#src/lightsout/index.ts';

/**
 * One standards pack as its page shows it: its documents and every rule's
 * listing row, with no prose and no fixture text.
 *
 * A name no pack this build loads answers to becomes the router's own not-found
 * signal here, on the server, where the engine's error is still an instance: a
 * class cannot survive the trip across the server-function wire, so matching one
 * on the other side would be matching a message. Every other failure travels as
 * itself.
 */
export const getPackServerFn = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ name: z.string().min(1) }))
	.handler(async ({ data }) => {
		try {
			return await getReader().getPack({ name: data.name });
		} catch (error) {
			if (error instanceof StandardsPackNotFoundError) {
				throw notFound();
			}

			throw error;
		}
	});
