import { StandardsPackRuleNotFoundError, toStandardsPackRuleView } from '@lightsout/engine';
import { notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getDefaultPackBundle } from '#src/lightsout/common/utils/getDefaultPackBundle.ts';

/**
 * One rule of the default pack whole — its argument and the files that prove it.
 *
 * Fetched a rule at a time rather than with the pack, because the pack's fixture
 * text runs to megabytes and a page shows one rule's worth of it at once. A rule
 * the pack does not carry becomes the router's own not-found signal here, on the
 * server, where the engine's error is still an instance.
 */
export const getDefaultPackRuleServerFn = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ rule: z.string().min(1) }))
	.handler(async ({ data }) => {
		try {
			return toStandardsPackRuleView({ bundle: getDefaultPackBundle(), rule: data.rule });
		} catch (error) {
			if (error instanceof StandardsPackRuleNotFoundError) {
				throw notFound();
			}

			throw error;
		}
	});
