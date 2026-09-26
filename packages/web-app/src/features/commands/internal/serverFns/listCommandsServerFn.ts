import { commandCatalog } from '@lightsout/engine';
import { createServerFn } from '@tanstack/react-start';

/**
 * Every command lightsout offers, as the catalog states them.
 *
 * Read from the engine directly, never through the reader: the catalog is
 * engine source rather than repo state, and `/commands` is a public page, which
 * reads nothing a repo holds.
 */
export const listCommandsServerFn = createServerFn({ method: 'GET' }).handler(async () => commandCatalog);
