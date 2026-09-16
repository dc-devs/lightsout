import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type LightsoutConfig, PlanningHandoff, PlanningVocabulary, type RunManifest } from '#src/contracts/index.ts';
import { orderPlanningPhases } from '#src/plan/workflow/common/utils/orderPlanningPhases.ts';
import { inspectPlanningCompletion } from '#src/plan/workflow/completion/index.ts';
import { planningAddressForPath } from '#src/plan/workflow/handoff/common/utils/planningAddressForPath.ts';
import { readPlanningHandoff } from '#src/plan/workflow/handoff/readPlanningHandoff.ts';
import { readPlanningEntrySnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig;
	plan: string;
	existing?: RunManifest;
	inherited?: PlanningHandoff;
}
/** New starts check current planning evidence. Existing runs retain their frozen authority and revalidate implementation separately. */
export const preparePlanningHandoff = async ({ cwd, config, plan, existing, inherited }: Params): Promise<PlanningHandoff | undefined> => {
	if (existing && !existing.planningHandoff) {
		if (inherited) throw new Error('A legacy run cannot adopt a canonical handoff');
		return undefined;
	}
	if (existing?.planningHandoff && inherited && canonicalJson({ value: existing.planningHandoff }) !== canonicalJson({ value: inherited }))
		throw new Error('Resume cannot replace its planning handoff');
	const address = await planningAddressForPath({ cwd, planPath: existing?.plan ?? plan });
	let handoff = existing?.planningHandoff ?? inherited;
	if (handoff) {
		await readPlanningHandoff({ cwd, handoff });
	} else if (address) {
		const snapshot = await readPlanningEntrySnapshot({ cwd, name: address.name });
		if (snapshot) {
			const readiness = await inspectPlanningCompletion({ cwd, config, snapshot, stage: PlanningVocabulary.Stage.Implementation });
			if (!readiness.ready) throw new Error(`Planning needs revalidation before implementation: ${readiness.missingReason}`);
			handoff = PlanningHandoff.parse({
				format: 'planning-handoff-v1',
				name: address.name,
				generation: snapshot.digest,
				phases: orderPlanningPhases({ record: snapshot.record }).map((artifact) => ({ id: artifact.phaseId, path: artifact.path })),
			});
		}
	}
	if (handoff) {
		if (address?.name !== handoff.name) throw new Error('Run path differs from its planning handoff');
		const snapshot = await readPlanningHandoff({ cwd, handoff });
		if (!snapshot.record.artifacts.some((artifact) => artifact.path === address.file && artifact.variant !== PlanningVocabulary.Artifact.Data))
			throw new Error('Run path is not a frozen deliverable');
	}
	return handoff;
};
