import { createServerFn } from '@tanstack/react-start';
import { getReader } from '#src/lightsout/index.ts';

/**
 * Every command lightsout offers, as the catalog states them.
 *
 * The one reader method that answers the same either way, because the catalog
 * is engine source rather than repo state — which is what lets `/commands`
 * render on a build with no repo under it.
 */
export const listCommandsServerFn = createServerFn({ method: 'GET' }).handler(async () => getReader().listCommands());
