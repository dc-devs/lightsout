import { z } from 'zod';
import { RunStatus } from './RunStatus';

/**
 * One pipeline step's durable state. `report` holds the agent's validated
 * output for the step — its shape is role-specific and validated by the
 * role's own contract at the boundary; the manifest stores it opaquely.
 */
export const StepRecord = z.object({
	id: z.string(),
	status: z.enum(RunStatus),
	attempts: z.number().int().nonnegative(),
	report: z.unknown().optional(),
	error: z.string().optional(),
});

export type StepRecord = z.infer<typeof StepRecord>;
