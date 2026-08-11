import { z } from 'zod';
import type { StandardsCheckRun } from './StandardsCheckRun.ts';
import { StandardsInputKind } from './StandardsInputKind.ts';

/**
 * The `check` export a rule folder's `check.ts` must provide. Validated at load
 * time because this is package code the engine imports and then calls: a
 * mistyped input kind or a missing function has to fail where the package is
 * named, not later inside a run.
 */
export const StandardsCheckModule = z.object({
	inputKind: z.enum(StandardsInputKind),
	run: z.custom<StandardsCheckRun>((value) => typeof value === 'function'),
});

export type StandardsCheckModule = z.infer<typeof StandardsCheckModule>;
