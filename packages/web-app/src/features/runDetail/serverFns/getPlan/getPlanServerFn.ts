import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getReader } from '#src/lightsout/index.ts';

/**
 * One plan document — the markdown a run implemented, or the work-list a
 * refactor or coverage run froze.
 *
 * Nothing is checked here beyond the path being a path: the engine's
 * `getPlanDocument` is what refuses a path resolving outside the repo root, and
 * a plan deleted after its run comes back as a recorded absence rather than an
 * error.
 */
export const getPlanServerFn = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ path: z.string().min(1) }))
	.handler(async ({ data }) => getReader().getPlan({ path: data.path }));
