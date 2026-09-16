import { messageOf } from '#src/common/utils/messageOf.ts';
import { type LightsoutConfig, PlanningVocabulary } from '#src/contracts/index.ts';
import { hasPlanningWorkflow } from '#src/plan/common/paths/hasPlanningWorkflow.ts';
import type { DurablePlanFile } from '#src/plan/common/types/DurablePlanFile.ts';
import { isDurablePlanAttachmentName } from '#src/plan/common/utils/isDurablePlanAttachmentName.ts';
import { durablePlanFiles } from '#src/plan/publish/durablePlanFiles.ts';
import { exportPlanningGeneration, inspectPlanningCompletion, readPlanningSnapshot } from '#src/plan/workflow/index.ts';

interface Params {
	cwd: string;
	name: string;
	expectedGeneration?: string;
	config: LightsoutConfig;
}

/** Canonical publication never rereads mutable flat views or silently falls back to legacy files. */
export const readPublicationFiles = async ({
	cwd,
	name,
	expectedGeneration,
	config,
}: Params): Promise<{ files: DurablePlanFile[]; resolved?: ReadonlyMap<string, string>; error?: string }> => {
	if (expectedGeneration === undefined && !(await hasPlanningWorkflow({ cwd, name }))) return durablePlanFiles({ cwd, name });
	try {
		const snapshot = await readPlanningSnapshot({ cwd, name });
		if (!snapshot) throw new Error('New-format plan is missing its canonical generation; restore the complete published plan');
		if (expectedGeneration !== undefined && snapshot.digest !== expectedGeneration)
			throw new Error('Planning changed before publication; refresh readiness for the current generation');
		const readiness = await inspectPlanningCompletion({ cwd, config, snapshot, stage: PlanningVocabulary.Stage.Implementation });
		if (!readiness.ready) throw new Error(`Plan is not ready for implementation: ${readiness.missingReason ?? 'Required obligations remain'}`);
		const resolved = exportPlanningGeneration({ snapshot });
		if ([...resolved.keys()].some((name) => !isDurablePlanAttachmentName({ name })))
			throw new Error('Canonical publication contains a non-durable attachment name');
		return { files: [], resolved };
	} catch (error) {
		return { files: [], error: messageOf({ error }) };
	}
};
