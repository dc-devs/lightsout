import { createServerFn } from '@tanstack/react-start';
import { getReader } from '#src/lightsout/index.ts';

/** Every run the open repo has state for, newest first. */
export const listRunsServerFn = createServerFn({ method: 'GET' }).handler(async () => getReader().listRuns());
