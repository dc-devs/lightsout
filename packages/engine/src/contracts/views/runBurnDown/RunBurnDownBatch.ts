import { z } from 'zod';
import { AdvisoryOutcome } from '#src/contracts/standardsCheck/AdvisoryOutcome.ts';
import { RunBurnDownBatchOutcome } from '#src/contracts/views/runBurnDown/RunBurnDownBatchOutcome.ts';

/** One batch of a refactor run's work-list, joined to what the run did about it. */
export const RunBurnDownBatch = z.object({
	/** Manifest step id: `batch-NN:<rule>:<folder>`. */
	id: z.string(),
	rule: z.string(),
	folder: z.string(),
	/** Blocking findings the work-list froze for this batch. */
	blocking: z.number(),
	/** `resolved` / `declined` from the batch report, or `not-run` for a work-list batch the run never reached. */
	outcome: z.enum(RunBurnDownBatchOutcome),
	/** The agent's own account of a declined batch, from its friction entries. */
	rationale: z.array(z.string()),
	advisoryOutcomes: z.array(AdvisoryOutcome),
});

export type RunBurnDownBatch = z.infer<typeof RunBurnDownBatch>;
