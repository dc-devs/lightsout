import { z } from 'zod';
import { BatchOutcome } from '@/contracts/refactor/BatchOutcome';

/** The step-record `report` payload a coverage batch persists. */
export const CoverageBatchReport = z.object({
	outcome: z.enum(BatchOutcome),
	/** Per batch file: statements pct before the batch and after re-measure. A file absent from the re-measured summary keeps afterPct equal to beforePct. */
	files: z.array(z.object({ path: z.string(), beforePct: z.number(), afterPct: z.number() })),
	/** The agent's friction/failure lines, for declined batches the human review reads. */
	rationale: z.array(z.string()),
});

export type CoverageBatchReport = z.infer<typeof CoverageBatchReport>;
