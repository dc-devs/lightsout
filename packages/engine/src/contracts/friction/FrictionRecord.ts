import { z } from 'zod';
import { FrictionEntry } from '#src/contracts/friction/FrictionEntry.ts';

/**
 * A friction entry as persisted to `.lightsout/friction.jsonl` — the entry
 * plus provenance (which run, which step, when). One JSON line per record.
 */
export const FrictionRecord = FrictionEntry.extend({
	at: z.string(),
	runId: z.string(),
	step: z.string(),
});

export type FrictionRecord = z.infer<typeof FrictionRecord>;
