import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import type { PlanningRecord } from '#src/contracts/index.ts';
import { planningDataArtifact } from '#src/plan/workflow/store/index.ts';

interface Params {
	record: PlanningRecord;
	artifacts: Map<string, string>;
	path: string;
	value: unknown;
}

/** Attach exact canonical data bytes and their descriptor together; history validation protects immutable namespaces. */
export const attachPlanningData = ({ record, artifacts, path, value }: Params): void => {
	const content = canonicalJson({ value });
	const descriptor = planningDataArtifact({ path, content });
	const index = record.artifacts.findIndex((artifact) => artifact.path === path);
	if (index === -1) record.artifacts.push(descriptor);
	else record.artifacts[index] = descriptor;
	artifacts.set(path, content);
};
