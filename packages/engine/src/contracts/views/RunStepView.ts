import { z } from 'zod';
import { RunStatus } from '#src/contracts/run/index.ts';

/** One pipeline step as the run detail page shows it: the manifest's record joined to what the agent ledger cost. */
export const RunStepView = z.object({
	id: z.string(),
	status: z.enum(RunStatus),
	attempts: z.number(),
	durationMs: z.number().optional(),
	changedFiles: z.array(z.string()),
	error: z.string().optional(),
	/** Agent invocations attributed to this step, supervisor consultations folded in. */
	invocations: z.number(),
	outputTokens: z.number(),
	costUsd: z.number(),
	/** The step's validated agent report, opaque here exactly as the manifest stores it. */
	report: z.unknown().optional(),
	/** Phased runs only: the phase file this step implemented, repo-relative. */
	planPath: z.string().optional(),
	/** Phased runs only: the child run id the step's PhaseReport names. */
	childRunId: z.string().optional(),
});

export type RunStepView = z.infer<typeof RunStepView>;
