import { z } from 'zod';
import { FrictionArea } from './FrictionArea';

/**
 * One moment where the system fought the agent — the raw signal the
 * self-improvement loop feeds on. Reported by agents in their WorkReport,
 * even on successful runs.
 */
export const FrictionEntry = z.object({
	area: z.enum(FrictionArea),
	detail: z.string(),
});

export type FrictionEntry = z.infer<typeof FrictionEntry>;
