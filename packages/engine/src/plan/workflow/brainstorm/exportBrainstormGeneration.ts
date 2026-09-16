import { renderBrainstormHandoff } from '#src/plan/workflow/brainstorm/renderBrainstormHandoff.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { exportPlanningGeneration } from '#src/plan/workflow/store/index.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

/** The brainstorm and plan transports share the same strict portable core; each publishes its own exact projections and marker. */
export const exportBrainstormGeneration = ({ snapshot }: Params): Map<string, string> => {
	const files = renderBrainstormHandoff({ snapshot });
	const text = exportPlanningGeneration({ snapshot }).get('planning-record.json');
	if (!text) throw new Error('Aligned brainstorm portable core is missing');
	files.set('brainstorm-record.json', text);
	return files;
};
