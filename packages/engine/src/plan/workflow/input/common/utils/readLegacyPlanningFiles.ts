import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { durablePlanFileNames } from '#src/plan/common/constants/durablePlanFileNames.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params {
	cwd: string;
	name: string;
}

/** Read only known planning inputs, never transcripts, hidden state or arbitrary neighboring files. */
export const readLegacyPlanningFiles = async ({ cwd, name }: Params): Promise<Map<string, string>> => {
	const root = planWorkspaceDir({ cwd, name });
	let entries: string[];
	try {
		entries = await readdir(root);
	} catch (error) {
		if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
		entries = [];
	}
	const files = new Map<string, string>();
	const records = ['notes.md', 'facts.json', 'brainstorm-decisions.json', ...durablePlanFileNames.records];
	for (const path of entries.sort())
		if (records.includes(path) || durablePlanFileNames.deliverable.test(path)) files.set(path, await readFile(join(root, path), 'utf8'));
	return files;
};
