import { z } from 'zod';
import { FrictionArea } from './FrictionArea';
import { FrictionKind } from './FrictionKind';

/**
 * One moment where the system fought the agent — the raw signal the
 * self-improvement loop feeds on. Reported by agents in their WorkReport,
 * even on successful runs.
 */
export const FrictionEntry = z.object({
	/** `friction` (something fought the agent) or `decision` (a silent-input guess). Omitted means friction. */
	kind: z.enum(FrictionKind).optional(),
	area: z.enum(FrictionArea),
	detail: z.string(),
});

export type FrictionEntry = z.infer<typeof FrictionEntry>;
