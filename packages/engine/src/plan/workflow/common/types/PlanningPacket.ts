import type { Effort, Permissions, PlanningDependency, PlanningVocabulary } from '#src/contracts/index.ts';

/** A role's sufficient context and its exact freshness basis, without an arbitrary size cutoff. */
export interface PlanningPacket {
	inputDigest: string;
	/** Present once final invocation composition captures configured arguments; absent values delegate to the harness. */
	execution?: { model?: string; effort?: Effort; permissions?: Permissions };
	invocationPolicyDigest?: string;
	systemPrompt: string;
	prompt: string;
	dependencies: PlanningDependency[];
	allowedEvidenceOperations: Array<(typeof PlanningVocabulary.Operation)[keyof typeof PlanningVocabulary.Operation]>;
	roleResultSchema: 'planning-role-result-v1';
}
