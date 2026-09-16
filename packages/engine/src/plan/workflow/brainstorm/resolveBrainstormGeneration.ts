import { sha256 } from '#src/common/utils/sha256.ts';
import { type LightsoutConfig, PlanningVocabulary } from '#src/contracts/index.ts';
import { exportBrainstormGeneration } from '#src/plan/workflow/brainstorm/exportBrainstormGeneration.ts';
import { inspectPlanningCompletion, readPlanningCompletion } from '#src/plan/workflow/completion/index.ts';
import { readPlanningEntrySnapshot, validatePlanningGeneration } from '#src/plan/workflow/store/index.ts';

interface Params {
	cwd: string;
	name: string;
	config: LightsoutConfig;
}

/** Preserve an archived aligned handoff when implementation planning extends it; unfinished new brainstorms never become legacy notes. */
export const resolveBrainstormGeneration = async ({ cwd, name, config }: Params): Promise<{ generation: string; files: Map<string, string> } | undefined> => {
	let snapshot = await readPlanningEntrySnapshot({ cwd, name });
	if (!snapshot) return undefined;
	if (!readPlanningCompletion({ snapshot, stage: PlanningVocabulary.Stage.Brainstorm })) {
		const archived = snapshot.artifacts.get('planning-brainstorm-handoff.json');
		if (archived) snapshot = validatePlanningGeneration({ text: archived, expectedDigest: sha256({ content: archived }), name });
		else if (!snapshot.record.work.some((work) => work.stage === PlanningVocabulary.Stage.Brainstorm)) return undefined;
	}
	const readiness = await inspectPlanningCompletion({ cwd, config, snapshot, stage: PlanningVocabulary.Stage.Brainstorm });
	if (!readiness.ready) throw new Error(`Brainstorm is not ready for auto-plan: ${readiness.missingReason ?? 'Required obligations remain'}`);
	return { generation: snapshot.digest, files: exportBrainstormGeneration({ snapshot }) };
};
