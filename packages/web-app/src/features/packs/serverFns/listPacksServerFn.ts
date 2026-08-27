import { createServerFn } from '@tanstack/react-start';
import { getReader } from '#src/lightsout/index.ts';

/**
 * Every standards pack the served repo loads, as the packs page lists them.
 *
 * No argument: which packs load is the repo's config talking, not the reader's
 * choice. A repo that loads none answers with an empty list rather than an
 * error — the page says so, and the reason is in the server log.
 */
export const listPacksServerFn = createServerFn({ method: 'GET' }).handler(async () => getReader().listPacks());
