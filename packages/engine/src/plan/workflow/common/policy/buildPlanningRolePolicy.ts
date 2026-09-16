import { buildFocusedPlanWriterInvocation } from '#src/agents/index.ts';
import planningRoleContract from '#src/agents/prompts/planningRoleContract.md';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { defaultExecutorFileLimit } from '#src/common/constants/defaultExecutorFileLimit.ts';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary, type PlanningWork, PlanVariant } from '#src/contracts/index.ts';
import { planningRoleBrief } from '#src/plan/workflow/common/constants/planningRoleBrief.ts';
import { planningRoleEnvironment } from '#src/plan/workflow/common/constants/planningRoleEnvironment.ts';
import { getPlanningRoleProtocol } from '#src/plan/workflow/common/runtime/getPlanningRoleProtocol.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';

interface Params {
	runtime: Pick<PlanningRuntime, 'config' | 'driver' | 'model' | 'effort' | 'permissions'>;
	role: PlanningWork['role'];
	stage: PlanningWork['stage'];
	standards: PlanningStandards;
}

/** Bind all template branches, exact instructions and schema independently of an author's output layout. */
export const buildPlanningRolePolicy = ({ runtime, role, stage, standards }: Params): { digest: string; instructionsDigest: string } => {
	const systemPrompt = `${planningRoleContract}\n\n${standards.channels.map((channel) => `# ${channel.channel} standards\n\n${channel.text}`).join('\n\n')}\n\n${planningRoleBrief}`;
	const author = role === PlanningVocabulary.Role.Draft || role === PlanningVocabulary.Role.Repair;
	const instructions = author
		? buildFocusedPlanWriterInvocation({
				authoritativePacket: { systemPrompt, prompt: '{}' },
				outputs: Object.values(PlanVariant).map((variant) => ({ path: 'assigned', variant })),
				limits: { executorFileLimit: runtime.config['executor-file-limit'] ?? defaultExecutorFileLimit, createdFileCeiling },
				docs: runtime.config.docs,
			}).systemPrompt
		: systemPrompt;
	const policy = { role, stage, instructions, resultSchema: getPlanningRoleProtocol({ role }).jsonSchema };
	const execution = {
		environment: planningRoleEnvironment,
		model: runtime.model ?? { delegated: 'harness-default' },
		effort: runtime.effort ?? { delegated: 'harness-default' },
		permissions: runtime.permissions ?? { delegated: 'harness-default' },
	};
	return {
		instructionsDigest: sha256({ content: canonicalJson({ value: policy }) }),
		digest: sha256({ content: canonicalJson({ value: { ...policy, driver: runtime.driver.name, execution } }) }),
	};
};
