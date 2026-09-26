import { toStandardsPackView } from '@lightsout/engine';
import { createServerFn } from '@tanstack/react-start';
import { getDefaultPackBundle } from '#src/lightsout/index.ts';

/**
 * The default pack lightsout ships — its documents and every rule's row, no
 * prose and no fixture text.
 *
 * Read from the copy bundled into the app, never from a repo: these are public
 * pages, and what they document is what every repo gets out of the box, the
 * same wherever the site runs.
 */
export const getDefaultPackServerFn = createServerFn({ method: 'GET' }).handler(async () => toStandardsPackView({ bundle: getDefaultPackBundle() }));
