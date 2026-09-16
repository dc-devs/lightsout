import { join } from 'node:path';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningFile, readPlanningSnapshot, validatePlanningGeneration } from '#src/plan/workflow/store/index.ts';

interface Params {
	cwd: string;
	name: string;
	directory?: string;
	core?: string;
	generation?: string;
}

/** A plan's archived handoff cannot be replaced by a different generation or downgraded to legacy notes. */
export const validateBrainstormRestoreBinding = async ({ cwd, name, directory, core, generation }: Params): Promise<PlanningSnapshot | undefined> => {
	let current = directory ? undefined : await readPlanningSnapshot({ cwd, name });
	if (directory) {
		try {
			const text = (await readPlanningFile({ path: join(directory, 'planning-record.json') })).toString('utf8');
			current = validatePlanningGeneration({ text, name, expectedDigest: sha256({ content: text }) });
		} catch (error) {
			if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
		}
	}
	const archived = current?.artifacts.get('planning-brainstorm-handoff.json');
	if (archived !== undefined && archived !== core) throw new Error('The restored plan requires its exact canonical brainstorm generation');
	if (core !== undefined && current && current.digest !== generation && archived !== core)
		throw new Error('The restored plan does not bind this brainstorm generation');
	return current;
};
