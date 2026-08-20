import { createServerFn } from '@tanstack/react-start';
import { getReader } from '#src/lightsout/index.ts';

/**
 * What this repo enforces and what is currently broken, in one payload.
 *
 * No argument: the standards view covers the whole repo the server was pointed
 * at, and narrowing it is the check command's job rather than the viewer's.
 */
export const getStandardsServerFn = createServerFn({ method: 'GET' }).handler(async () => getReader().getStandards());
