import { buildFocusedPlanWriterInvocation } from '#src/agents/index.ts';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { defaultExecutorFileLimit } from '#src/common/constants/defaultExecutorFileLimit.ts';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary, PlanVariant } from '#src/contracts/index.ts';
import { buildPlanningRolePolicy } from '#src/plan/workflow/common/policy/buildPlanningRolePolicy.ts';
import { PlanningExecutionPolicy } from '#src/plan/workflow/common/policy/PlanningExecutionPolicy.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';

interface Params {
	runtime: Pick<PlanningRuntime, 'config' | 'driver' | 'model' | 'effort' | 'permissions' | 'stage'>;
	standards: PlanningStandards;
}

/** Capture expected policy before entry; mutable generations cannot silently replace it during a run. */
export const buildPlanningExecutionPolicy = ({ runtime, standards }: Params): NonNullable<PlanningRuntime['executionPolicy']> => {
	const policy = PlanningExecutionPolicy.parse({
		format: 'planning-execution-policy-v1',
		stage: runtime.stage,
		execution: {
			driver: runtime.driver.name,
			model: runtime.model ?? null,
			effort: runtime.effort ?? null,
			permissions: runtime.permissions ?? null,
			unspecified: 'harness-default',
		},
		standardsPolicyDigest: standards.policyDigest,
		authoringRequirements: buildFocusedPlanWriterInvocation({
			authoritativePacket: { systemPrompt: '', prompt: '{}' },
			outputs: Object.values(PlanVariant).map((variant) => ({ path: 'assigned', variant })),
			limits: { executorFileLimit: runtime.config['executor-file-limit'] ?? defaultExecutorFileLimit, createdFileCeiling },
			docs: runtime.config.docs,
		}).systemPrompt,
		roles: Object.fromEntries(
			Object.values(PlanningVocabulary.Role).map((role) => [role, buildPlanningRolePolicy({ runtime, standards, role, stage: runtime.stage })]),
		),
	});
	const digest = sha256({ content: canonicalJson({ value: policy }) });
	return { policy, reference: { stage: runtime.stage, artifact: `planning-execution-policies/${digest}.json`, sha256: digest } };
};
