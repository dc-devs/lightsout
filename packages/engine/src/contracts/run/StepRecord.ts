import { z } from 'zod';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';

/**
 * One pipeline step's durable state. `report` holds the agent's validated
 * output for the step — its shape is role-specific and validated by the
 * role's own contract at the boundary; the manifest stores it opaquely.
 */
export const StepRecord = z.object({
	id: z.string(),
	status: z.enum(RunStatus),
	attempts: z.number().int().nonnegative(),
	/** Active time spent in this step, accumulated across attempts and resumes. */
	durationMs: z.number().optional(),
	/** Files this step changed (paths from its reports) — per-step attribution; the run-wide union lives on the manifest. */
	changedFiles: z.array(z.string()).optional(),
	report: z.unknown().optional(),
	error: z.string().optional(),
});

export type StepRecord = z.infer<typeof StepRecord>;
