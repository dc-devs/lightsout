import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { readPlanningUniverse } from '#src/plan/workflow/common/evidence/readPlanningUniverse.ts';
import type { PlanningEvidencePolicy } from '#src/plan/workflow/common/types/PlanningEvidencePolicy.ts';

interface Params {
	cwd: string;
	roots: string[];
	policy: PlanningEvidencePolicy;
}

/** A broad fingerprint detects observable drift; it never certifies unobservable reads as known. */
export const fingerprintUnknownPlanningReach = async ({ cwd, roots, policy }: Params): Promise<string> => {
	const result = await readPlanningUniverse({ cwd, roots, exclude: policy.exclude });
	return sha256({ content: canonicalJson({ value: { members: result.members, files: result.files, policy } }) });
};
