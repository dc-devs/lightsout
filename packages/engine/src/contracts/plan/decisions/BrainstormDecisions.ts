import { z } from 'zod';
import { DecisionRow } from '#src/contracts/plan/decisions/DecisionRow.ts';
import { DecisionSource } from '#src/contracts/plan/decisions/DecisionSource.ts';

/**
 * The brainstorm-authored `brainstorm-decisions.json`: the plan name plus the
 * decisions settled during `/brainstorm`, before planning began. Same row shape
 * as `DecisionsRecord` with `source` pinned to `Brainstorm` — the origin label
 * is what keeps these rows distinguishable from the plan's own interview in the
 * finished Decision Log, so a mislabelled row is a hard read failure rather
 * than a silent relabel. `plan draft` reads this file when it exists; its
 * absence is a normal path, not an error.
 */
export const BrainstormDecisions = z.object({
	planName: z.string(),
	decisions: z.array(DecisionRow.extend({ source: z.literal(DecisionSource.Brainstorm) })).default([]),
});

export type BrainstormDecisions = z.infer<typeof BrainstormDecisions>;
