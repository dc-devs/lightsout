import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { PlanningEvidencePolicy } from '#src/plan/workflow/common/types/PlanningEvidencePolicy.ts';

interface Params {
	exclude?: string[];
}

/** Bookkeeping never participates in a broad semantic scan; explicit file reads retain their exact path. */
export const planningEvidencePolicy = ({ exclude = [] }: Params = {}): PlanningEvidencePolicy => {
	const exclusions = [...new Set(['.git', '.git/**', '.lightsout', '.lightsout/**', ...exclude])].sort();
	return { exclude: exclusions, identity: sha256({ content: canonicalJson({ value: exclusions }) }) };
};
