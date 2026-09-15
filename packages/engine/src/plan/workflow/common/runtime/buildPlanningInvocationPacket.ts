import planningRoleContract from '#src/agents/prompts/planningRoleContract.md';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { defaultExecutorFileLimit } from '#src/common/constants/defaultExecutorFileLimit.ts';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary, type PlanningWork, PlanVariant } from '#src/contracts/index.ts';
import { buildFocusedPlanWriterInvocation } from '#src/plan/draft/focused/index.ts';
import { getPlanningRoleProtocol } from '#src/plan/workflow/common/runtime/getPlanningRoleProtocol.ts';
import { readPlanningObservations } from '#src/plan/workflow/common/runtime/readPlanningObservations.ts';
import type { PlanningPacket } from '#src/plan/workflow/common/types/PlanningPacket.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';
import { selectWritablePlanningArtifacts } from '#src/plan/workflow/common/utils/selectWritablePlanningArtifacts.ts';
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
	const evidence = readPlanningObservations({ snapshot, paths: observationPaths });
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
	// The policy covers all template branches, independent of files a successful author later creates.
	const stable = author
		? buildFocusedPlanWriterInvocation({
				authoritativePacket: { ...base, prompt: '{}' },
				outputs: Object.values(PlanVariant).map((variant) => ({ path: 'assigned', variant })),
				limits,
				docs: runtime.config.docs,
			})
		: base;
	const execution = { model: runtime.model, effort: runtime.effort, permissions: runtime.permissions };
	const resultSchema = getPlanningRoleProtocol({ role: work.role }).jsonSchema;
	const invocationPolicyDigest = sha256({
		content: canonicalJson({
			value: {
				role: work.role,
				stage: work.stage,
				instructions: stable.systemPrompt,
				resultSchema,
				driver: runtime.driver.name,
				execution: {
					model: execution.model ?? { delegated: 'harness-default' },
					effort: execution.effort ?? { delegated: 'harness-default' },
					permissions: execution.permissions ?? { delegated: 'harness-default' },
				},
			},
		}),
	});
	let prompt = composed.prompt;
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
			content: canonicalJson({ value: { semantic: packet.inputDigest, systemPrompt: composed.systemPrompt, prompt, resultSchema, invocationPolicyDigest } }),
		}),
	};
};
