import { z } from 'zod';
import { PlanningEvidence, PlanningEvidenceRequest } from '#src/contracts/index.ts';
import type { PlanningEvidenceContent } from '#src/plan/workflow/common/types/PlanningEvidenceContent.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

const observation = z
	.object({
		request: PlanningEvidenceRequest,
		evidence: PlanningEvidence,
		content: z.string(),
		omissions: z.array(z.object({ path: z.string(), kind: z.string(), target: z.string().optional() }).strict()).optional(),
	})
	.strict();

interface Params {
	snapshot: PlanningSnapshot;
	paths: string[];
}

/** Resolve exact persisted observations; missing or malformed continuation data is an integrity failure. */
export const readPlanningObservations = ({ snapshot, paths }: Params): Array<PlanningEvidenceContent & { request: PlanningEvidenceRequest }> =>
	paths.map((path) => {
		const content = snapshot.artifacts.get(path);
		if (content === undefined) throw new Error(`Missing planning observation: ${path}`);
		return observation.parse(JSON.parse(content));
	});
