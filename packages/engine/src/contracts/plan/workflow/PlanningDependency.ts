import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

const identity = { id: z.string().min(1) };
const roots = z.array(PlanningPath).min(1);
const options = z.object({ regex: z.boolean(), caseSensitive: z.boolean(), glob: z.string().min(1), exclude: z.array(z.string()) }).strict();
/** Observed dependencies include negative and search-universe evidence, not only existing files. */
export const PlanningDependency = z.discriminatedUnion('kind', [
	z.object({ ...identity, kind: z.literal(PlanningVocabulary.Dependency.Content), path: PlanningPath, sha256: PlanningDigest }).strict(),
	z.object({ ...identity, kind: z.literal(PlanningVocabulary.Dependency.Absence), path: PlanningPath }).strict(),
	z
		.object({
			...identity,
			kind: z.literal(PlanningVocabulary.Dependency.Search),
			roots,
			query: z.string().min(1),
			options,
			universeFingerprint: PlanningDigest,
			resultFingerprint: PlanningDigest,
		})
		.strict(),
	z
		.object({
			...identity,
			kind: z.literal(PlanningVocabulary.Dependency.Membership),
			root: PlanningPath,
			policy: z.object({ exclude: z.array(z.string()), recursive: z.boolean().optional() }).strict(),
			fingerprint: PlanningDigest,
		})
		.strict(),
	z
		.object({
			...identity,
			kind: z.literal(PlanningVocabulary.Dependency.Collection),
			collection: z.enum(PlanningVocabulary.Collection),
			scope: z.string().min(1),
			memberDigests: z.record(z.string().min(1), PlanningDigest),
		})
		.strict(),
	z
		.object({
			...identity,
			kind: z.literal(PlanningVocabulary.Dependency.Unknown),
			roots,
			reason: z.string().min(1),
			policy: z
				.object({ exclude: z.array(z.string()), identity: PlanningDigest })
				.strict()
				.optional(),
			fallbackFingerprint: PlanningDigest,
		})
		.strict(),
]);
export type PlanningDependency = z.infer<typeof PlanningDependency>;
