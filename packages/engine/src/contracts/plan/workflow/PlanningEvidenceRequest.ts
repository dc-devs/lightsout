import { z } from 'zod';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

const base = { requestId: z.string().min(1), reason: z.string().min(1) };
/** Nonterminal evidence requests are executed by the engine between Driver invocations. */
export const PlanningEvidenceRequest = z.discriminatedUnion('operation', [
	z.object({ ...base, operation: z.literal(PlanningVocabulary.Operation.ReadFile), path: PlanningPath }).strict(),
	z
		.object({
			...base,
			operation: z.literal(PlanningVocabulary.Operation.ReadRange),
			path: PlanningPath,
			startLine: z.number().int().positive(),
			endLine: z.number().int().positive(),
		})
		.strict()
		.refine((request) => request.endLine >= request.startLine, 'Range ends before it starts'),
	z.object({ ...base, operation: z.literal(PlanningVocabulary.Operation.List), root: PlanningPath, exclude: z.array(z.string()) }).strict(),
	z
		.object({
			...base,
			operation: z.literal(PlanningVocabulary.Operation.Search),
			roots: z.array(PlanningPath).min(1),
			query: z.string().min(1),
			options: z.object({ regex: z.boolean(), caseSensitive: z.boolean(), glob: z.string().min(1), exclude: z.array(z.string()) }).strict(),
		})
		.strict(),
]);
export type PlanningEvidenceRequest = z.infer<typeof PlanningEvidenceRequest>;
