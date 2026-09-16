import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params {
	cwd: string;
	name: string;
}

/** New-format traces prevent a missing canonical record from silently reopening legacy planning or implementation. */
export const hasPlanningWorkflow = async ({ cwd, name }: Params): Promise<boolean> => {
	const directory = planWorkspaceDir({ cwd, name });
	for (const file of ['.planning', 'planning-record.json', 'planning-views.json', 'planning-standards.json', 'brainstorm-record.json']) {
		try {
			await lstat(join(directory, file));
			return true;
		} catch (error) {
			if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
		}
	}
	let marked = false;
	for (const [file, marker] of [
		['plan-attachments.json', '"planningGeneration"'],
		['brainstorm-attachments.json', '"brainstormGeneration"'],
	]) {
		try {
			marked = (await readFile(join(directory, file), 'utf8')).includes(marker);
		} catch (error) {
			if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
		}
		if (marked) break;
	}
	return marked;
};
