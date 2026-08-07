import { z } from 'zod';
import { DedupVerdict } from '@/contracts/dedup/DedupVerdict';

/**
 * The dedup judge agent's contract — one verdict per detected candidate (plus
 * any behavioral duplicates it notices). Validated by `invokeAgentWithContract`;
 * an empty `verdicts` array is a legitimate "nothing is a real duplicate" result.
 */
export const DedupJudgment = z.object({
	verdicts: z.array(DedupVerdict).default([]),
});

export type DedupJudgment = z.infer<typeof DedupJudgment>;
