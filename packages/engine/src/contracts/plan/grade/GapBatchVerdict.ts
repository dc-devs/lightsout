import { z } from 'zod';
import { GapGroupVerdict } from '#src/contracts/plan/grade/GapGroupVerdict.ts';

/** What one gap judge returns for one batch: a list of rulings that between them must account for every observation the batch supplied. */
export const GapBatchVerdict = z.object({ verdicts: z.array(GapGroupVerdict).default([]) });

export type GapBatchVerdict = z.infer<typeof GapBatchVerdict>;
