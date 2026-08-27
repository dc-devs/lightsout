import { createServerFn } from '@tanstack/react-start';
import { getReader } from '#src/lightsout/index.ts';

/** Every plan workspace the open repo has, newest first — stat'd rather than read, so the list costs one walk. */
export const listPlanWorkspacesServerFn = createServerFn({ method: 'GET' }).handler(async () => getReader().listPlanWorkspaces());
