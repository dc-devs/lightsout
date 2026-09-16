import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { PlanningExecutionPolicy } from '#src/plan/workflow/common/policy/PlanningExecutionPolicy.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
	stage: PlanningRuntime['stage'];
}

/** A policy reference cannot grant authority without its exact typed immutable bytes. */
export const readPlanningExecutionPolicy = ({ snapshot, stage }: Params): PlanningRuntime['executionPolicy'] => {
	const references = snapshot.record.executionPolicies?.filter((item) => item.stage === stage) ?? [];
	if (references.length > 1) throw new Error('Duplicate planning execution policy stage');
	const reference = references[0];
	if (!reference) return undefined;
	const descriptor = snapshot.record.artifacts.find((item) => item.path === reference.artifact);
	const content = snapshot.artifacts.get(reference.artifact);
	if (
		reference.artifact !== `planning-execution-policies/${reference.sha256}.json` ||
		descriptor?.variant !== PlanningVocabulary.Artifact.Data ||
		descriptor.sha256 !== reference.sha256 ||
		content === undefined ||
		sha256({ content }) !== reference.sha256
	)
		throw new Error('Planning execution policy is missing or corrupt');
	const policy = PlanningExecutionPolicy.parse(JSON.parse(content));
	if (policy.stage !== stage) throw new Error('Planning execution policy stage mismatch');
	return { reference, policy };
};
