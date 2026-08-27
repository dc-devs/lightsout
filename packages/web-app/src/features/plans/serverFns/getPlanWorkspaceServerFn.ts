import { PlanWorkspaceNotFoundError } from '@lightsout/engine';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { readOrNotFound } from '#src/common/utils/readOrNotFound.ts';
import { getReader } from '#src/lightsout/index.ts';

/**
 * One plan workspace as its page shows it: the files it holds, the records that
 * parsed, and the runs that implemented it.
 *
 * A name no folder answers to becomes the router's own not-found signal, for the
 * reason `readOrNotFound` states.
 */
export const getPlanWorkspaceServerFn = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ name: z.string().min(1) }))
	.handler(({ data }) => readOrNotFound({ read: () => getReader().getPlanWorkspace({ name: data.name }), absent: [PlanWorkspaceNotFoundError] }));
