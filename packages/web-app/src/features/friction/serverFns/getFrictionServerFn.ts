import { createServerFn } from '@tanstack/react-start';
import { getReader } from '#src/lightsout/index.ts';

/**
 * Every friction entry this repo's agents recorded, newest last as the log
 * wrote them.
 *
 * No argument: friction is repo-wide, and narrowing it to one run is what the
 * run detail's own tab already does from the run view it holds.
 */
export const getFrictionServerFn = createServerFn({ method: 'GET' }).handler(async () => getReader().getFriction());
