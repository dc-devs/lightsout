import { z } from 'zod';
import { FrictionArea } from '@/contracts/friction/FrictionArea';
import { FrictionKind } from '@/contracts/friction/FrictionKind';

/**
 * One moment where the system fought the agent — the raw signal the
 * self-improvement loop feeds on. Reported by agents in their WorkReport,
 * even on successful runs.
 */
export const FrictionEntry = z.object({
	/** `friction` (something fought the agent) or `decision` (a silent-input guess). Omitted means friction. */
	kind: z.enum(FrictionKind).optional(),
	/**
	 * Best-effort taxonomy, never load-bearing: an unrecognized label coerces
	 * to `other` instead of failing the whole report — `detail` carries the
	 * real signal. (A live run's valid zero-change report died over an
	 * invented `"scope"` area.)
	 */
	area: z.enum(FrictionArea).catch(FrictionArea.Other),
	detail: z.string(),
});

export type FrictionEntry = z.infer<typeof FrictionEntry>;
