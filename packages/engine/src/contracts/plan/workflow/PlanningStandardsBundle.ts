import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningStandard } from '#src/contracts/plan/workflow/common/types/PlanningStandard.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Portable exact standards bytes; descriptors and immutable artifact hashes establish their generation binding. */
export const PlanningStandardsBundle = z
	.object({
		format: z.literal('planning-standards-v1'),
		policyDigest: PlanningDigest,
		observations: z.array(z.object({ path: z.string().min(1), kind: z.enum(PlanningVocabulary.Observation), sha256: PlanningDigest }).strict()),
		channels: z.array(PlanningStandard.omit({ artifact: true }).extend({ text: z.string() }).strict()),
	})
	.strict()
	.refine((bundle) => new Set(bundle.channels.map((channel) => channel.channel)).size === bundle.channels.length, 'Standards channels must be unique');
export type PlanningStandardsBundle = z.infer<typeof PlanningStandardsBundle>;
