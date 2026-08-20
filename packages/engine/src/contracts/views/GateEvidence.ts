import { z } from 'zod';
import { GateResult } from '#src/contracts/gates/index.ts';

/**
 * One `commands.jsonl` line: a gate execution plus the two fields only the log
 * carries.
 *
 * Built by extending `GateResult` rather than restating it, so the shape a gate
 * run emits and the shape a reader parses back cannot drift apart.
 */
export const GateEvidence = GateResult.extend({
	at: z.string(),
	/** Pipeline step in flight when the command ran; absent on records written outside a step. */
	step: z.string().optional(),
});

export type GateEvidence = z.infer<typeof GateEvidence>;
