import { sha256 } from '#src/common/utils/sha256.ts';
import { renderBrainstormHandoff } from '#src/plan/workflow/brainstorm/renderBrainstormHandoff.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { validatePlanningGeneration } from '#src/plan/workflow/store/index.ts';

interface Params {
	files: ReadonlyMap<string, string>;
	name: string;
	generation: string;
}

/** Hash-consistent edited notes cannot inherit another design's approval or challenge. */
export const validateBrainstormGeneration = ({ files, name, generation }: Params): PlanningSnapshot => {
	const text = files.get('brainstorm-record.json');
	if (!text) throw new Error('New-format brainstorm requires brainstorm-record.json');
	const snapshot = validatePlanningGeneration({ text, name, expectedDigest: sha256({ content: text }) });
	if (snapshot.digest !== generation) throw new Error('Brainstorm marker selects a different canonical generation');
	const projected = renderBrainstormHandoff({ snapshot });
	if (files.size !== projected.size + 1 || [...projected].some(([path, text]) => files.get(path) !== text))
		throw new Error('Brainstorm notes and decisions differ from the approved canonical design');
	return snapshot;
};
