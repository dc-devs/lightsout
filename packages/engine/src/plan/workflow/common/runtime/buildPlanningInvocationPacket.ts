import { buildFocusedPlanWriterInvocation } from '#src/agents/index.ts';
import planningRoleContract from '#src/agents/prompts/planningRoleContract.md';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { defaultExecutorFileLimit } from '#src/common/constants/defaultExecutorFileLimit.ts';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary, type PlanningWork, PlanVariant } from '#src/contracts/index.ts';
import { assertPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/assertPlanningExecutionPolicy.ts';
import { buildPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/buildPlanningExecutionPolicy.ts';
import { buildPlanningRolePolicy } from '#src/plan/workflow/common/policy/buildPlanningRolePolicy.ts';
import { getPlanningRoleProtocol } from '#src/plan/workflow/common/runtime/getPlanningRoleProtocol.ts';
import { readPlanningObservations } from '#src/plan/workflow/common/runtime/readPlanningObservations.ts';
import type { PlanningPacket } from '#src/plan/workflow/common/types/PlanningPacket.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';
import { selectWritablePlanningArtifacts } from '#src/plan/workflow/common/utils/selectWritablePlanningArtifacts.ts';
import { requirePlanningObservationContent } from '#src/plan/workflow/common/utils/transport/requirePlanningObservationContent.ts';
import { buildPlanningPacket } from '#src/plan/workflow/context/index.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	work: PlanningWork;
	standards: PlanningStandards;
	observationPaths: string[];
}

/** Compose and bind the exact role instructions, focused template, response protocol and execution arguments before claiming an invocation. */
export const buildPlanningInvocationPacket = async ({ runtime, snapshot, work, standards, observationPaths }: Params): Promise<PlanningPacket> => {
	assertPlanningExecutionPolicy({ runtime, snapshot });
	if (work.stage !== runtime.stage) throw new Error('Planning invocation belongs to a different stage');
	const evidence = requirePlanningObservationContent({ observations: readPlanningObservations({ snapshot, paths: observationPaths }) });
	const packet = buildPlanningPacket({ snapshot, work, standards, evidence });
	const base = { systemPrompt: `${planningRoleContract}\n\n${packet.systemPrompt}`, prompt: packet.prompt };
	const author = work.role === PlanningVocabulary.Role.Draft || work.role === PlanningVocabulary.Role.Repair;
	const limits = { executorFileLimit: runtime.config['executor-file-limit'] ?? defaultExecutorFileLimit, createdFileCeiling };
	const outputs = selectWritablePlanningArtifacts({ record: snapshot.record, scope: work.scope }).map((artifact) => ({
		path: artifact.path,
		variant:
			artifact.variant === PlanningVocabulary.Artifact.Overview
				? PlanVariant.Overview
				: artifact.variant === PlanningVocabulary.Artifact.Phase
					? PlanVariant.Phase
					: PlanVariant.Single,
	}));
	const composed = author ? buildFocusedPlanWriterInvocation({ authoritativePacket: base, outputs, limits, docs: runtime.config.docs }) : base;
	const execution = { model: runtime.model, effort: runtime.effort, permissions: runtime.permissions };
	const resultSchema = getPlanningRoleProtocol({ role: work.role }).jsonSchema;
	const invocationPolicyDigest = buildPlanningRolePolicy({ runtime, role: work.role, stage: work.stage, standards }).digest;
	if (runtime.executionPolicy && buildPlanningExecutionPolicy({ runtime, standards }).reference.sha256 !== runtime.executionPolicy.reference.sha256)
		throw new Error('Planning invocation differs from its captured execution policy');
	let prompt = composed.prompt;
	if (
		runtime.executionPolicy &&
		[PlanningVocabulary.Role.DesignReview, PlanningVocabulary.Role.ImplementationReview, PlanningVocabulary.Role.IntegrationReview].some(
			(role) => role === work.role,
		)
	)
		prompt = canonicalJson({
			value: {
				...JSON.parse(prompt),
				requiredAuthoringPolicy: runtime.executionPolicy.policy.authoringRequirements,
				executionPolicyDigest: runtime.executionPolicy.reference.sha256,
			},
		});
	let dependencies = packet.dependencies;
	if (work.role === PlanningVocabulary.Role.IntegrationReview) {
		if (!runtime.services.integrationContext) throw new Error('Planning integration context service is unavailable');
		const integration = await runtime.services.integrationContext({ runtime, snapshot });
		prompt = canonicalJson({ value: { context: JSON.parse(prompt), integration } });
		dependencies = [...dependencies, ...integration.dependencies];
	}
	return {
		...packet,
		...composed,
		prompt,
		dependencies,
		execution,
		invocationPolicyDigest,
		inputDigest: sha256({
			content: canonicalJson({
				value: {
					semantic: packet.inputDigest,
					systemPrompt: composed.systemPrompt,
					prompt,
					resultSchema,
					invocationPolicyDigest,
					executionPolicyDigest: runtime.executionPolicy?.reference.sha256,
				},
			}),
		}),
	};
};
