import type { z } from 'zod';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params<T> {
	snapshot: PlanningSnapshot;
	path: string;
	schema: z.ZodType<T>;
}

/** Read typed canonical proof bytes only when their recorded content identity agrees. */
export const readPlanningProof = <T>({ snapshot, path, schema }: Params<T>): T | undefined => {
	const descriptor = snapshot.record.artifacts.find((artifact) => artifact.path === path);
	const content = snapshot.artifacts.get(path);
	if (!descriptor || content === undefined || descriptor.sha256 !== sha256({ content })) return undefined;
	try {
		const parsed = schema.safeParse(JSON.parse(content));
		return parsed.success && canonicalJson({ value: parsed.data }) === content ? parsed.data : undefined;
	} catch {
		return undefined;
	}
};
