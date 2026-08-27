import { StandardsPackNotFoundError, StandardsPackRuleNotFoundError } from '@lightsout/engine';
import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getReader } from '#src/lightsout/index.ts';

/**
 * One rule whole — its argument and the files that prove it.
 *
 * Fetched a rule at a time rather than with the pack, because a pack's fixture
 * text runs to megabytes and a page shows one rule's worth of it at once.
 *
 * Either half of the address can be wrong — a pack nothing answers to, or a rule
 * the pack does not carry — and both become the router's own not-found signal
 * here, on the server, for the same reason `getPackServerFn` does it there.
 */
export const getPackRuleServerFn = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ name: z.string().min(1), rule: z.string().min(1) }))
	.handler(async ({ data }) => {
		try {
			return await getReader().getPackRule({ name: data.name, rule: data.rule });
		} catch (error) {
			if (error instanceof StandardsPackNotFoundError || error instanceof StandardsPackRuleNotFoundError) {
				throw notFound();
			}

			throw error;
		}
	});
