import { z } from 'zod';
import { DraftImplementation } from '#src/contracts/plan/draft/DraftImplementation.ts';
import { PlanningStep } from '#src/contracts/plan/progress/PlanningStep.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';

/** One planning step's latest attempt, as the planning record stores it. */
export const PlanningStepRecord = z.object({
	step: z.enum(PlanningStep),
	status: z.enum(RunStatus),
	/** Invocations of this step's subcommand in this plan folder, this one included. */
	attempts: z.number().int().positive(),
	/** The process that recorded the latest start. */
	pid: z.number().int(),
	/** ISO time the latest attempt started. */
	startedAt: z.string(),
	/** ISO time the latest attempt finished; absent while it runs. */
	finishedAt: z.string().optional(),
	/** The latest attempt's duration; absent while it runs. */
	durationMs: z.number().nonnegative().optional(),
	/** Which drafting implementation produced this step's work. Written by the draft step alone; absent on every other step and on a record written before this field existed. */
	implementation: z.enum(DraftImplementation).optional(),
});

export type PlanningStepRecord = z.infer<typeof PlanningStepRecord>;
