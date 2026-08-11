import { z } from 'zod';
import { DedupFinding } from '@/contracts/dedup/DedupFinding';

/**
 * The persisted `dedup.json`: every confirmed prior-art duplication the Dedup
 * Review pass surfaced for a plan. An empty `findings` array is the clean
 * result — no name-collides remained or the judge ruled every candidate
 * distinct. The skill reads this to conduct the interactive resolution.
 */
export const DedupReport = z.object({
	planName: z.string(),
	findings: z.array(DedupFinding).default([]),
	reviewedAt: z.string(),
});

export type DedupReport = z.infer<typeof DedupReport>;
