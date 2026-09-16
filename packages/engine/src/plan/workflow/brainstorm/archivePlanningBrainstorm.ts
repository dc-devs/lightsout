import { type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { exportBrainstormGeneration } from '#src/plan/workflow/brainstorm/exportBrainstormGeneration.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
	record: PlanningRecord;
	artifacts: Map<string, string>;
	stage: PlanningRuntime['stage'];
}

/** Preserve the aligned design before implementation policy or claims extend its semantic basis. */
export const archivePlanningBrainstorm = ({ snapshot, record, artifacts, stage }: Params): void => {
	if (
		stage !== PlanningVocabulary.Stage.Implementation ||
		artifacts.has('planning-brainstorm-handoff.json') ||
		!record.work.some((work) => work.stage === PlanningVocabulary.Stage.Brainstorm) ||
		record.work.some((work) => work.stage === stage)
	)
		return;
	const handoff = exportBrainstormGeneration({ snapshot }).get('brainstorm-record.json');
	if (!handoff) throw new Error('The aligned brainstorm handoff is missing');
	attachPlanningData({ record, artifacts, path: 'planning-brainstorm-handoff.json', value: JSON.parse(handoff) });
};
