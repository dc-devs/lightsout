import { type PlanningContract, type PlanningHandoff, PlanningVocabulary } from '#src/contracts/index.ts';
import { renderPlanningContract } from '#src/plan/workflow/draft/index.ts';
import { planningAddressForPath } from '#src/plan/workflow/handoff/common/utils/planningAddressForPath.ts';
import { readPlanningHandoff } from '#src/plan/workflow/handoff/readPlanningHandoff.ts';
import { renderHandoffContext } from '#src/plan/workflow/handoff/renderHandoffContext.ts';

interface Params {
	cwd: string;
	handoff: PlanningHandoff;
	plan: string;
	overview?: string;
}
/** Exact plan text stays parseable; the receiving agent also gets original claims, standards and bounded freedom. */
export const readHandoffSources = async ({
	cwd,
	handoff,
	plan,
	overview,
}: Params): Promise<{ planContent: string; overviewContent?: string; contract: PlanningContract }> => {
	const snapshot = await readPlanningHandoff({ cwd, handoff });
	const address = await planningAddressForPath({ cwd, planPath: plan });
	const artifact = snapshot.record.artifacts.find((item) => item.path === address?.file && item.variant !== PlanningVocabulary.Artifact.Data);
	if (address?.name !== handoff.name || !artifact) throw new Error('Run input differs from the frozen handoff');
	const text = snapshot.artifacts.get(artifact.path);
	if (text === undefined) throw new Error('Missing frozen plan bytes');
	const contract = renderPlanningContract({ snapshot, phaseId: artifact.phaseId });
	const context = renderHandoffContext({ snapshot, contract });
	let result: { planContent: string; overviewContent?: string; contract: PlanningContract } = { planContent: text + context, contract };
	if (overview) {
		const overviewAddress = await planningAddressForPath({ cwd, planPath: overview });
		const overviewArtifact = snapshot.record.artifacts.find(
			(item) => item.path === overviewAddress?.file && item.variant === PlanningVocabulary.Artifact.Overview,
		);
		const overviewText = overviewArtifact && snapshot.artifacts.get(overviewArtifact.path);
		if (overviewAddress?.name !== handoff.name || overviewText === undefined) throw new Error('Run overview differs from the frozen handoff');
		result = { planContent: text, overviewContent: overviewText + context, contract };
	}
	return result;
};
