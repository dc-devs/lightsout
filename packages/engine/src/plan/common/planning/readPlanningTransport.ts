import { sha256 } from '#src/common/utils/sha256.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/index.ts';
import { exportPlanningGeneration, PlanningPortableGeneration, validatePlanningGeneration } from '#src/plan/workflow/index.ts';

interface Params {
	files: ReadonlyMap<string, string>;
	name?: string;
	planningGeneration?: string;
}

/** Transport views must be byte-for-byte projections of one selected canonical generation. */
export const readPlanningTransport = ({ files, name, planningGeneration }: Params): PlanningSnapshot | undefined => {
	const text = files.get('planning-record.json');
	if (text === undefined) {
		if (planningGeneration !== undefined || files.has('planning-standards.json'))
			throw new Error('New-format plan requires its canonical planning-record.json');
		return undefined;
	}
	const portable = PlanningPortableGeneration.parse(JSON.parse(text));
	const snapshot = validatePlanningGeneration({ text, expectedDigest: sha256({ content: text }), name: name ?? portable.record.planName });
	if (planningGeneration !== undefined && planningGeneration !== snapshot.digest) throw new Error('Plan marker and canonical generation disagree');
	const projected = exportPlanningGeneration({ snapshot });
	if (projected.size !== files.size || [...projected].some(([path, content]) => files.get(path) !== content))
		throw new Error('Public plan views differ from their canonical generation');
	return snapshot;
};
